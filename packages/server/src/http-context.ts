// SPDX-License-Identifier: AGPL-3.0-only
import type { FastifyInstance } from 'fastify'
import type { DatabaseSlot } from './database-slot.js'
import type { AppOptions, DiscoveredRoute } from './app.js'
import type { Clock, RaceService } from './service.js'

export interface LiveSocket {
  send: (data: string) => void
  close: (code?: number, reason?: string) => void
  on: (event: 'close', listener: () => void) => void
}

export interface HttpCtx {
  app: FastifyInstance
  options: AppOptions
  service: RaceService
  clock: Clock
  slot: DatabaseSlot
  secretBox: { current: string }
  strictLimit: object
  recordingLimit: object
  authenticated: (request: { headers: { authorization?: string | string[]; cookie?: string | string[] }; ip: string }) => boolean
  discovered: DiscoveredRoute[]
  sockets: Set<LiveSocket>
  expiryTimers: Set<ReturnType<typeof setTimeout>>
  requireBackup: (reason: string) => Promise<void>
}

export function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export function workspace(service: RaceService) {
  const state = service.state()
  return {
    ...state,
    settings: service.settings(),
    clubs: service.listClubs(),
    duplicates: service.duplicateClubs(),
    entries: service.entries(),
    timing: service.timingEvents(),
    ties: service.tieGroups(),
    audit: service.audit(),
    results: state.event ? service.results('public') : [],
    clubStats: state.event ? service.clubStatistics() : [],
  }
}
