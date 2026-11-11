// SPDX-License-Identifier: AGPL-3.0-only
import type { FastifyInstance } from 'fastify'
import type { AppDb } from '@ert/storage'
import { buildContext, DEFAULT_GLOBAL_MAX, DEFAULT_RECORDING_MAX, DEFAULT_STRICT_MAX, keyRacePath } from './app-boot.js'
import type { DatabaseSlot } from './database-slot.js'
import { registerRequestGuards, registerErrorHandler, registerAccessGuard } from './http-guard.js'
import { registerLaunchRoute, registerLiveSocket } from './live-socket.js'
import { registerKeyRoutes } from './key-routes.js'
import type { LaunchCodes } from './launch-auth.js'
import { registerRaceRoutes } from './race-routes.js'
import type { Clock, RaceService } from './service.js'

export { DEFAULT_GLOBAL_MAX, DEFAULT_RECORDING_MAX, DEFAULT_STRICT_MAX }

export interface DiscoveredRoute {
  method: string
  url: string
}

export interface RateLimitSettings {
  globalMax?: number
  strictMax?: number
  recordingMax?: number
}

export interface AppOptions {
  db: AppDb
  testMode?: boolean
  webDist?: string
  runtime?: { url: string; dataDir: string; dbPath: string }
  /** Consistent backup. Lock, retention and import wait for it. */
  backup?: (reason: string) => Promise<unknown>
  rateLimit?: RateLimitSettings
  /** Set when the shell passed a launch token on stdin. Static files stay open. */
  launch?: { token: string; codes: LaunchCodes }
  /** Test hook for the production request log. */
  logStream?: NodeJS.WritableStream
  /** When set, unlock replaces this database. The proxy follows it. */
  slot?: DatabaseSlot
  /** Called after a locked file is opened. */
  onOpen?: (db: AppDb) => void
}

export async function createApp(options: AppOptions): Promise<{ app: FastifyInstance; service: RaceService; clock: Clock; discovered: DiscoveredRoute[] }> {
  const ctx = await buildContext(options)
  registerRequestGuards(ctx.app, Boolean(options.launch))
  registerErrorHandler(ctx.app)
  registerAccessGuard(ctx)
  registerRaceRoutes(ctx)
  registerKeyRoutes(ctx.app, {
    slot: ctx.slot,
    secretBox: ctx.secretBox,
    racePath: keyRacePath(ctx),
    strictLimit: ctx.strictLimit,
    onOpen: options.onOpen,
  })
  registerLaunchRoute(ctx)
  await registerLiveSocket(ctx)
  return { app: ctx.app, service: ctx.service, clock: ctx.clock, discovered: ctx.discovered }
}
