// SPDX-License-Identifier: AGPL-3.0-only
import Fastify from 'fastify'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { AppError } from '@ert/core'
import { databaseProxy } from './database-slot.js'
import type { AppOptions, DiscoveredRoute } from './app.js'
import type { HttpCtx, LiveSocket } from './http-context.js'
import { redactRequestUrl } from './launch-auth.js'
import { websocketPayload } from './live-socket.js'
import { sessionSecret, tokenFromRequest, verifyToken } from './session.js'
import { Clock, RaceService } from './service.js'

/** Shared budget for one IP. Route overrides replace this bucket. */
export const DEFAULT_GLOBAL_MAX = 300
/** PIN check, imports, and retention. */
export const DEFAULT_STRICT_MAX = 5
/** Finish and start recording. High enough that a race-day burst is not refused. */
export const DEFAULT_RECORDING_MAX = 6_000
const RATE_WINDOW = '1 minute'

function loggerOptions(options: AppOptions) {
  if (options.testMode && !options.logStream) return false
  return {
    level: 'info' as const,
    stream: options.logStream,
    serializers: {
      req(request: { method: string; url: string }) {
        return { method: request.method, url: redactRequestUrl(request.url) }
      },
    },
  }
}

async function registerLimits(app: HttpCtx['app'], options: AppOptions) {
  const globalMax = options.rateLimit?.globalMax ?? DEFAULT_GLOBAL_MAX
  const strictMax = options.rateLimit?.strictMax ?? DEFAULT_STRICT_MAX
  const recordingMax = options.rateLimit?.recordingMax ?? DEFAULT_RECORDING_MAX
  await app.register(rateLimit, { global: true, max: globalMax, timeWindow: RATE_WINDOW })
  const limit = (max: number) => ({ config: { rateLimit: { max, timeWindow: RATE_WINDOW } } })
  return { strictLimit: limit(strictMax), recordingLimit: limit(recordingMax) }
}

function recordRoute(discovered: DiscoveredRoute[], opts: { method: string | string[]; url: string }): void {
  const methods = Array.isArray(opts.method) ? opts.method : [opts.method]
  for (const method of methods) {
    if (method === 'HEAD') continue
    discovered.push({ method, url: opts.url })
  }
}

function headerPair(request: { headers: { authorization?: string | string[]; cookie?: string | string[] } }) {
  const header = Array.isArray(request.headers.authorization) ? request.headers.authorization[0] : request.headers.authorization
  const cookie = Array.isArray(request.headers.cookie) ? request.headers.cookie[0] : request.headers.cookie
  return { authorization: header, cookie }
}

async function runBackup(options: AppOptions, reason: string): Promise<void> {
  if (!options.backup) return
  try {
    await options.backup(reason)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Backup failed'
    throw new AppError('BACKUP_FAILED', message)
  }
}

function wireBus(ctx: HttpCtx): void {
  const send = (type: string, payload: unknown) => {
    const message = JSON.stringify({ type, payload: websocketPayload(type, payload) })
    for (const socket of ctx.sockets) socket.send(message)
  }
  ctx.service.bus.on('TimingEventRecorded', (payload) => send('timing_event.created', payload))
  ctx.service.bus.on('CorrectionApplied', (payload) => send('correction.created', payload))
  ctx.service.bus.on('ResultsInvalidated', (payload) => send('results.updated', payload))
}

export async function buildContext(options: AppOptions): Promise<HttpCtx> {
  const clock = new Clock()
  const slot = options.slot ?? { current: options.db }
  const database = databaseProxy(slot)
  const service = new RaceService(database, clock)
  const secretBox = { current: sessionSecret(database) }
  const discovered: DiscoveredRoute[] = []
  const app = Fastify({ logger: loggerOptions(options) })
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
  })
  const limits = await registerLimits(app, options)
  const sockets = new Set<LiveSocket>()
  const expiryTimers = new Set<ReturnType<typeof setTimeout>>()
  const ctx: HttpCtx = {
    app,
    options,
    service,
    clock,
    slot,
    secretBox,
    strictLimit: limits.strictLimit,
    recordingLimit: limits.recordingLimit,
    authenticated: (request) => verifyToken(secretBox.current, tokenFromRequest(headerPair(request))),
    discovered,
    sockets,
    expiryTimers,
    requireBackup: (reason) => runBackup(options, reason),
  }
  app.addHook('onClose', async () => {
    for (const timer of expiryTimers) clearTimeout(timer)
    expiryTimers.clear()
  })
  app.addHook('onRoute', (opts) => recordRoute(discovered, opts))
  wireBus(ctx)
  return ctx
}

export function keyRacePath(ctx: HttpCtx): string {
  const runtime = ctx.options.runtime?.dbPath
  if (ctx.slot.current.filePath === ':memory:' && runtime) return runtime
  return ctx.slot.current.filePath
}
