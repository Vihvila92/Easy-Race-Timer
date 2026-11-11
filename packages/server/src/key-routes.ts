// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { AppError } from '@ert/core'
import {
  type AppDb,
  acknowledgeRecoveryKeyShown,
  confirmActingPassword,
  KeyError,
  RaceFileError,
  regenerateRecoveryKey,
  rewrapAdminSlot,
  rotateDataKey,
  unlockWithPassword,
  unlockWithRecovery,
} from '@ert/storage'
import { envelopeReady, type DatabaseSlot } from './database-slot.js'
import { isLoopbackAddress } from './access.js'
import { sessionSecret } from './session.js'

type KeyStateName =
  | 'locked'
  | 'dev'
  | 'admin'
  | 'recovery-gate'
  | 'recovery-unshown'
  | 'temporary-password'

export interface KeyRouteContext {
  slot: DatabaseSlot
  secretBox: { current: string }
  racePath: string
  strictLimit: object
  onOpen?: (db: AppDb) => void
}

const passwordBody = z.object({
  target: z.enum(['self', 'other']).optional(),
  slot: z.union([z.literal(0), z.literal(1)]).optional(),
  password: z.string(),
  confirm: z.string(),
  currentPassword: z.string().optional(),
  actingPassword: z.string().optional(),
})
const recoveryIssueBody = z.object({ actingPassword: z.string() })

const unlockBody = z.object({ password: z.string() })
const recoveryBody = z.object({ recoveryKey: z.string() })
const ackBody = z.object({ generation: z.number().int().positive() })
const rotateBody = z.object({
  actingPassword: z.string(),
  other: z.enum(['present', 'temporary']),
  password: z.string(),
  confirm: z.string(),
})

export function raceApiOpen(db: AppDb, racePath: string, startedLocked = false): boolean {
  const { state } = describeKeys(db, racePath, startedLocked)
  return state === 'admin' || state === 'dev'
}

function raceHeading(db: AppDb): { raceName?: string; raceDate?: string } {
  if (db.filePath === ':memory:') return {}
  const event = db.get<{ name: string; date_start: string }>('SELECT name, date_start FROM event LIMIT 1')
  if (!event) return {}
  return { raceName: event.name, raceDate: event.date_start }
}

const SESSION_STATES = new Set<KeyStateName>(['admin', 'recovery-gate', 'recovery-unshown', 'temporary-password'])

function keyState(db: AppDb, racePath: string, startedLocked: boolean): KeyStateName {
  const locked = db.filePath === ':memory:' && (startedLocked || envelopeReady(racePath))
  if (locked) return 'locked'
  const kind = db.keySession?.kind
  if (kind && SESSION_STATES.has(kind)) return kind
  return 'dev'
}

function describeKeys(db: AppDb, racePath: string, startedLocked = false): { state: KeyStateName; fileName: string; raceName?: string; raceDate?: string } {
  const fileName = path.basename(db.filePath === ':memory:' ? racePath : db.filePath)
  return { state: keyState(db, racePath, startedLocked), fileName, ...raceHeading(db) }
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body ?? {})
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'The request was not understood')
  return parsed.data
}

function sendKeyError(reply: FastifyReply, error: unknown): unknown {
  if (error instanceof RaceFileError && error.kind === 'newer') {
    return reply.status(409).send({ error: { code: 'RACE_FILE_NEWER', message: 'This race file was saved by a newer version.' } })
  }
  if (!(error instanceof KeyError)) throw error
  const status = new AppError(error.code, error.message).status
  const retryAfterMs = error.retryAfterMs
  return reply.status(status).send({
    error: {
      code: error.code,
      message: error.message,
      ...(retryAfterMs !== undefined ? { retryAfterMs, details: { retryAfterMs } } : {}),
    },
  })
}

function closePrevious(previous: AppDb): void {
  try {
    previous.raw.close()
  } catch {
    // The previous connection may already be closed.
  }
}

function adopt(ctx: KeyRouteContext, opened: AppDb): void {
  const previous = ctx.slot.current
  if (previous === opened) return
  ctx.slot.current = opened
  closePrevious(previous)
  ctx.secretBox.current = sessionSecret(opened)
  ctx.onOpen?.(opened)
}

function actingSlot(db: AppDb): 0 | 1 {
  const slot = db.keySession?.slotIndex
  if (slot === 0 || slot === 1) return slot
  throw new KeyError('UNLOCK_FAILED')
}

async function openWithPassword(ctx: KeyRouteContext, password: string): Promise<{ state: KeyStateName }> {
  const current = ctx.slot.current
  if (current.filePath !== ':memory:' && current.keySession) return describeKeys(current, ctx.racePath)
  const opened = await unlockWithPassword(ctx.racePath, password)
  adopt(ctx, opened)
  return describeKeys(opened, ctx.racePath)
}

async function openWithRecovery(ctx: KeyRouteContext, recoveryKey: string): Promise<{ state: KeyStateName }> {
  const current = ctx.slot.current
  if (current.filePath !== ':memory:' && current.keySession?.kind === 'recovery-gate') return describeKeys(current, ctx.racePath)
  const opened = await unlockWithRecovery(ctx.racePath, recoveryKey)
  if (current.filePath !== ':memory:') {
    opened.raw.close()
    throw new KeyError('UNLOCK_FAILED')
  }
  adopt(ctx, opened)
  return describeKeys(opened, ctx.racePath)
}

function chosenSlot(body: z.infer<typeof passwordBody>): 0 | 1 {
  if (body.slot === 0 || body.slot === 1) return body.slot
  throw new AppError('VALIDATION_ERROR', 'The request was not understood')
}

async function resetFromRecovery(db: AppDb, body: z.infer<typeof passwordBody>): Promise<{ singleAdmin: boolean }> {
  await rewrapAdminSlot(db, chosenSlot(body), { password: body.password, confirm: body.confirm })
  return { singleAdmin: false }
}

async function changePassword(db: AppDb, body: z.infer<typeof passwordBody>): Promise<{ singleAdmin: boolean }> {
  if (db.keySession?.kind === 'recovery-gate') return resetFromRecovery(db, body)
  const self = actingSlot(db)
  const other = body.target === 'other'
  const slot = other ? (self === 0 ? 1 : 0) : self
  if (other) {
    if (!body.actingPassword) throw new AppError('VALIDATION_ERROR', 'The request was not understood')
    await confirmActingPassword(db, body.actingPassword)
  }
  await rewrapAdminSlot(db, slot, { password: body.password, confirm: body.confirm }, other ? undefined : body.currentPassword)
  return { singleAdmin: other }
}

function shownKey(buffer: Buffer): string {
  const printed = buffer.toString('ascii')
  buffer.fill(0)
  return printed
}

async function issueRecovery(db: AppDb, actingPassword: string): Promise<{ recoveryKey: string; generation: number }> {
  await confirmActingPassword(db, actingPassword)
  const issued = await regenerateRecoveryKey(db)
  return { recoveryKey: shownKey(issued.recoveryKey), generation: issued.generation }
}

async function rotate(db: AppDb, body: z.infer<typeof rotateBody>): Promise<{ recoveryKey: string; generation: number; temporary: boolean }> {
  const rotated = await rotateDataKey(db, {
    actingPassword: body.actingPassword,
    other: {
      kind: body.other === 'temporary' ? 'temporary' : 'password',
      password: { password: body.password, confirm: body.confirm },
    },
  })
  return { recoveryKey: shownKey(rotated.recoveryKey), generation: rotated.generation, temporary: body.other === 'temporary' }
}

function guard(reply: FastifyReply, work: () => Promise<unknown>): Promise<unknown> {
  return work().catch((error: unknown) => sendKeyError(reply, error))
}

function registerUnlockRoutes(app: FastifyInstance, ctx: KeyRouteContext): void {
  app.post('/api/v1/keys/unlock', ctx.strictLimit, async (request, reply) => {
    const body = parseBody(unlockBody, request.body)
    return guard(reply, () => openWithPassword(ctx, body.password))
  })
  app.post('/api/v1/keys/recover', ctx.strictLimit, async (request, reply) => {
    const body = parseBody(recoveryBody, request.body)
    return guard(reply, () => openWithRecovery(ctx, body.recoveryKey))
  })
}

function registerChangeRoutes(app: FastifyInstance, ctx: KeyRouteContext, status: () => { state: KeyStateName }): void {
  app.post('/api/v1/keys/password', ctx.strictLimit, async (request, reply) => guard(reply, async () => {
    const extra = await changePassword(ctx.slot.current, parseBody(passwordBody, request.body))
    return { ...status(), ...extra }
  }))
  app.post('/api/v1/keys/recovery', ctx.strictLimit, async (request, reply) => guard(reply, () => {
    const body = parseBody(recoveryIssueBody, request.body)
    return issueRecovery(ctx.slot.current, body.actingPassword)
  }))
  app.post('/api/v1/keys/recovery/ack', ctx.strictLimit, async (request, reply) => guard(reply, async () => {
    await acknowledgeRecoveryKeyShown(ctx.slot.current, parseBody(ackBody, request.body).generation)
    return status()
  }))
  app.post('/api/v1/keys/rotate', ctx.strictLimit, async (request, reply) => {
    const body = parseBody(rotateBody, request.body)
    return guard(reply, () => rotate(ctx.slot.current, body))
  })
}

function registerKeyGuards(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.split('?')[0].startsWith('/api/v1/keys')) reply.header('cache-control', 'no-store')
  })
  app.addHook('preHandler', async (request, reply) => {
    if (reply.sent) return
    const url = request.routeOptions.url ?? ''
    if (!url.startsWith('/api/v1/keys') || isLoopbackAddress(request.ip)) return
    reply.status(403).send({ error: { code: 'VALIDATION_ERROR', message: 'Not allowed' } })
  })
}

export function registerKeyRoutes(app: FastifyInstance, ctx: KeyRouteContext): void {
  const status = () => describeKeys(ctx.slot.current, ctx.racePath, Boolean(ctx.slot.startedLocked))
  registerKeyGuards(app)
  app.get('/api/v1/keys/status', async () => status())
  registerUnlockRoutes(app, ctx)
  registerChangeRoutes(app, ctx, status)
}
