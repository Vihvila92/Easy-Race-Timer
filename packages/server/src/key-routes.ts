// SPDX-License-Identifier: AGPL-3.0-only
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { AppError } from '@ert/core'
import {
  type AppDb,
  acknowledgeRecoveryKeyShown,
  KeyError,
  regenerateRecoveryKey,
  rewrapAdminSlot,
  rotateDataKey,
  unlockWithPassword,
  unlockWithRecovery,
} from '@ert/storage'
import { envelopeReady, type DatabaseSlot } from './database-slot.js'
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
  target: z.enum(['self', 'other']),
  password: z.string(),
  confirm: z.string(),
  currentPassword: z.string().optional(),
})

const unlockBody = z.object({ password: z.string() })
const recoveryBody = z.object({ recoveryKey: z.string() })
const ackBody = z.object({ generation: z.number().int().positive() })
const rotateBody = z.object({
  actingPassword: z.string(),
  other: z.enum(['present', 'temporary']),
  password: z.string(),
  confirm: z.string(),
})

function describeKeys(db: AppDb, racePath: string): { state: KeyStateName } {
  if (db.filePath === ':memory:' && envelopeReady(racePath)) return { state: 'locked' }
  const kind = db.keySession?.kind
  if (kind === 'admin' || kind === 'recovery-gate' || kind === 'recovery-unshown' || kind === 'temporary-password') {
    return { state: kind }
  }
  return { state: 'dev' }
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body ?? {})
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'The request was not understood')
  return parsed.data
}

function sendKeyError(reply: FastifyReply, error: unknown): unknown {
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

function adopt(ctx: KeyRouteContext, opened: AppDb): void {
  const previous = ctx.slot.current
  ctx.slot.current = opened
  if (previous !== opened && previous.filePath === ':memory:') {
    try {
      previous.raw.close()
    } catch {
      // The stand-in database may already be closed.
    }
  }
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

async function changePassword(db: AppDb, body: z.infer<typeof passwordBody>): Promise<{ singleAdmin: boolean }> {
  const self = actingSlot(db)
  const slot = body.target === 'other' ? (self === 0 ? 1 : 0) : self
  const currentPassword = body.target === 'self' ? body.currentPassword : undefined
  await rewrapAdminSlot(db, slot, { password: body.password, confirm: body.confirm }, currentPassword)
  return { singleAdmin: body.target === 'other' }
}

function shownKey(buffer: Buffer): string {
  const printed = buffer.toString('ascii')
  buffer.fill(0)
  return printed
}

async function issueRecovery(db: AppDb): Promise<{ recoveryKey: string; generation: number }> {
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
  app.post('/api/v1/keys/recovery', ctx.strictLimit, async (_request, reply) => guard(reply, () => issueRecovery(ctx.slot.current)))
  app.post('/api/v1/keys/recovery/ack', ctx.strictLimit, async (request, reply) => guard(reply, async () => {
    await acknowledgeRecoveryKeyShown(ctx.slot.current, parseBody(ackBody, request.body).generation)
    return status()
  }))
  app.post('/api/v1/keys/rotate', ctx.strictLimit, async (request, reply) => {
    const body = parseBody(rotateBody, request.body)
    return guard(reply, () => rotate(ctx.slot.current, body))
  })
}

export function registerKeyRoutes(app: FastifyInstance, ctx: KeyRouteContext): void {
  const status = () => describeKeys(ctx.slot.current, ctx.racePath)
  app.get('/api/v1/keys/status', async () => status())
  registerUnlockRoutes(app, ctx)
  registerChangeRoutes(app, ctx, status)
}
