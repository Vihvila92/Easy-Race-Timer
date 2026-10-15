import path from 'node:path'
import { existsSync } from 'node:fs'
import Fastify, { type FastifyInstance } from 'fastify'
import { z } from 'zod'
import fastifyStatic from '@fastify/static'
import websocket from '@fastify/websocket'
import { AppError, errorBody } from '@ert/core'
import { AppDb } from '@ert/storage'
import { Clock, RaceService } from './service.js'

export interface AppOptions {
  db: AppDb
  testMode?: boolean
  webDist?: string
  runtime?: { url: string; dataDir: string; dbPath: string }
  /** Consistent backup. Lock, retention and import wait for it. */
  backup?: (reason: string) => Promise<unknown>
}

export function createApp(options: AppOptions): { app: FastifyInstance; service: RaceService; clock: Clock } {
  const clock = new Clock()
  const service = new RaceService(options.db, clock)
  const app = Fastify({ logger: options.testMode ? false : { level: 'info' } })
  const sockets = new Set<{ send: (data: string) => void }>()
  service.bus.on('TimingEventRecorded', (payload) => broadcast('timing_event.created', payload))
  service.bus.on('CorrectionApplied', (payload) => broadcast('correction.created', payload))
  service.bus.on('ResultsInvalidated', (payload) => broadcast('results.updated', payload))

  function broadcast(type: string, payload: unknown) {
    const message = JSON.stringify({ type, payload })
    for (const socket of sockets) socket.send(message)
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.status).send(errorBody(error))
      return
    }
    const validation = error as { validation?: unknown; message?: string }
    if (validation.validation) {
      reply.status(422).send({ error: { code: 'VALIDATION_ERROR', message: validation.message, details: validation.validation } })
      return
    }
    app.log.error(error)
    reply.status(500).send({ error: { code: 'VALIDATION_ERROR', message: 'Internal error' } })
  })

  app.get('/api/v1/health', async () => ({ ok: true, version: '0.1.0' }))
  app.get('/api/v1/runtime', async () => ({
    url: options.runtime?.url ?? '',
    dataDir: options.runtime?.dataDir ?? '',
    dbPath: options.runtime?.dbPath ?? '',
  }))
  app.get('/api/v1/time', async () => ({ time_ms: clock.now(), iso: new Date(clock.now()).toISOString() }))
  app.post('/api/v1/test/clock', async (request, reply) => {
    if (!options.testMode) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } })
    const body = clockBody.parse(request.body ?? {})
    clock.set(body.at ? Date.parse(body.at) : null)
    return { time_ms: clock.now() }
  })

  app.get('/api/v1/bootstrap', async () => workspace(service))
  app.post('/api/v1/events/import', async (request) => service.importEvent(request.body as Record<string, unknown>))
  app.post('/api/v1/clubs/import', async (request) => {
    const body = request.body as { clubs: { id: string; abbreviation: string | null; name: string; municipality?: string; official_id?: string }[] }
    return service.importClubs(body.clubs)
  })
  app.get('/api/v1/clubs', async (request) => {
    const query = (request.query as { q?: string }).q
    if (query !== undefined) return service.searchClubs(query)
    return service.listClubs()
  })
  app.get('/api/v1/clubs/duplicates', async () => service.duplicateClubs())
  app.post('/api/v1/clubs', async (request) => service.createClub(request.body as { abbreviation: string; name: string; municipality?: string; raw?: string }))
  app.post('/api/v1/clubs/:id/merge', async (request) => {
    const body = request.body as { targetId: string; reason: string; addAlias?: boolean }
    return service.mergeClubs((request.params as { id: string }).id, body.targetId, body.addAlias !== false, body.reason)
  })
  app.post('/api/v1/clubs/:id/unmerge', async (request) => {
    const body = request.body as { reason: string }
    return service.undoMerge((request.params as { id: string }).id, body.reason)
  })
  app.post('/api/v1/entries/import/preview', async (request) => service.previewCsv((request.body as { csv: string }).csv))
  app.post('/api/v1/entries/import', async (request) => service.importCsv((request.body as { csv: string }).csv))
  app.get('/api/v1/suggestions', async (request) => service.suggestions(((request.query as { basis?: 'birth_date' | 'birth_year' }).basis) || service.settings().age_basis))
  app.post('/api/v1/settings/age-basis', async (request) => {
    const body = request.body as { basis: 'birth_date' | 'birth_year'; apply?: boolean }
    return service.setAgeBasis(body.basis, Boolean(body.apply))
  })
  app.post('/api/v1/settings/offset-policy', async (request) => {
    const body = request.body as { policy: 'ranked' | 'unranked' | 'open_category' }
    service.setOffsetPolicy(body.policy)
    return { ok: true }
  })
  app.post('/api/v1/settings/pin', async (request) => {
    service.setPin((request.body as { pin: string }).pin)
    return { ok: true }
  })
  app.post('/api/v1/settings/pin/check', async (request) => service.checkPin((request.body as { pin?: string }).pin))
  app.post('/api/v1/entries/late', async (request) => service.registerLate(request.body as Parameters<RaceService['registerLate']>[0]))
  app.post('/api/v1/entries/change-bib', async (request) => {
    const body = request.body as { bibFrom: number; bibTo: number; reason: string }
    service.changeBib(body.bibFrom, body.bibTo, body.reason)
    return { ok: true }
  })
  app.post('/api/v1/entries/status', async (request) => {
    const body = request.body as { bib: number; status: string; reason: string }
    service.setStatus(body.bib, body.status, body.reason)
    return { ok: true }
  })
  app.post('/api/v1/entries/offset', async (request) => {
    const body = request.body as { bib: number; offsetMs: number; reason: string }
    service.setStartOffset(body.bib, body.offsetMs, body.reason)
    return { ok: true }
  })
  app.post('/api/v1/entries/race', async (request) => {
    const body = request.body as { bib: number; race: string; bibTo?: number; reason: string }
    return service.changeRace(body.bib, body.race, body.bibTo, body.reason)
  })
  app.post('/api/v1/club-actions/confirm', async (request) => {
    const body = request.body as { raw: string; clubId: string; addAlias?: boolean; reason: string }
    service.confirmClubSuggestion(body.raw, body.clubId, body.addAlias !== false, body.reason)
    return { ok: true }
  })
  app.post('/api/v1/club-actions/conflict', async (request) => service.resolveAbbreviationConflict(request.body as Parameters<RaceService['resolveAbbreviationConflict']>[0]))
  app.post('/api/v1/races/:id/start', async (request) => {
    const body = request.body as { timeMs?: number; confirm?: boolean }
    return service.startRace((request.params as { id: string }).id, body.timeMs ?? clock.now(), Boolean(body.confirm))
  })
  app.post('/api/v1/timing-events', async (request) => service.recordFinish(request.body as { id?: string; timeMs: number; bib?: number | null; mode?: string }))
  app.post('/api/v1/corrections/assign-bib', async (request) => {
    const body = request.body as { tapId: string; bib: number; reason: string }
    service.assignBib(body.tapId, body.bib, body.reason)
    return { ok: true }
  })
  app.post('/api/v1/corrections/void', async (request) => {
    const body = request.body as { tapId: string; reason: string }
    service.voidTap(body.tapId, body.reason)
    return { ok: true }
  })
  app.post('/api/v1/corrections/restore', async (request) => {
    const body = request.body as { tapId: string; reason: string }
    service.restoreTap(body.tapId, body.reason)
    return { ok: true }
  })
  app.post('/api/v1/corrections/copy-time', async (request) => {
    const body = request.body as { sourceTapId: string; bib: number; reason: string }
    return service.copyTime(body.sourceTapId, body.bib, body.reason)
  })
  app.get('/api/v1/timing-events', async () => service.timingEvents())
  app.get('/api/v1/ties', async () => service.tieGroups())
  app.post('/api/v1/ties/confirm', async (request) => {
    service.confirmTie(request.body as Parameters<RaceService['confirmTie']>[0])
    return { ok: true }
  })
  app.post('/api/v1/ties/undo', async (request) => {
    const body = request.body as { raceId: string; displayTime: string; reason: string }
    service.undoTie(body.raceId, body.displayTime, body.reason)
    return { ok: true }
  })
  app.get('/api/v1/races/:id/lock-blockers', async (request) => ({ blockers: service.lockBlockers((request.params as { id: string }).id) }))
  app.post('/api/v1/races/:id/lock', async (request) => {
    service.lockRace((request.params as { id: string }).id)
    await requireBackup('lock')
    return { ok: true }
  })
  app.post('/api/v1/races/:id/unlock', async (request) => {
    const body = request.body as { reason: string }
    service.unlockRace((request.params as { id: string }).id, body.reason)
    return { ok: true }
  })
  app.get('/api/v1/results', async (request, reply) => {
    const query = request.query as { format?: string; view?: 'public' | 'internal' }
    const view = query.view ?? 'public'
    if (query.format === 'csv') {
      reply.header('content-type', 'text/csv; charset=utf-8')
      return service.resultsCsv(view)
    }
    if (query.format === 'html') {
      reply.header('content-type', 'text/html; charset=utf-8')
      const locale = (request.query as { locale?: string }).locale
      return service.resultsHtml(locale === 'en' || locale === 'fi' ? locale : undefined)
    }
    return service.results(view)
  })
  app.get('/api/v1/club-stats', async () => service.clubStatistics())
  app.get('/api/v1/audit', async () => service.audit())
  app.post('/api/v1/retention/run', async (request) => {
    const body = (request.body as { at?: string } | undefined) ?? {}
    const now = body.at ? Date.parse(body.at) : clock.now()
    return service.runRetention(now)
  })
  app.get('/api/v1/persons/:id/export', async (request) => service.exportPerson((request.params as { id: string }).id))
  app.post('/api/v1/persons/:id/consents', async (request) => {
    const body = request.body as { granted: boolean; channel?: string }
    const personId = (request.params as { id: string }).id
    const { CONSENT_TEXT_VERSION } = await import('@ert/people')
    const now = clock.now()
    options.db.run(
      `INSERT INTO consent (id, person_id, purpose, granted, given_by, text_version, channel, recorded_at) VALUES (?, ?, 'long_term_storage', ?, 'self', ?, ?, ?)`,
      `c_${now}`, personId, body.granted ? 1 : 0, CONSENT_TEXT_VERSION, body.channel ?? 'kiosk', now,
    )
    service.bus.emit('ConsentChanged', { personId, granted: body.granted })
    return { ok: true }
  })
  app.get('/api/v1/sync/export', async (_request, reply) => {
    reply.header('content-type', 'application/zip')
    return service.exportErtx()
  })
  app.post('/api/v1/sync/import', async (request) => {
    const body = request.body as { base64: string }
    await service.importErtx(Buffer.from(body.base64, 'base64'))
    return { ok: true }
  })

  app.register(websocket)
  app.register(async (instance) => {
    instance.get('/ws', { websocket: true }, (socket) => {
      sockets.add(socket)
      socket.send(JSON.stringify({ type: 'device.status', payload: { proto: 1 } }))
      socket.on('close', () => sockets.delete(socket))
    })
  })

  const dist = options.webDist
  if (dist && existsSync(dist)) {
    app.register(fastifyStatic, { root: path.resolve(dist), prefix: '/' })
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/') || request.url.startsWith('/ws')) {
        reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } })
        return
      }
      reply.sendFile('index.html')
    })
  }

  async function requireBackup(reason: string) {
    if (!options.backup) return
    try {
      await options.backup(reason)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Backup failed'
      throw new AppError('BACKUP_FAILED', message)
    }
  }

  return { app, service, clock }
}

const clockBody = z.object({ at: z.string().nullable().optional() })

function workspace(service: RaceService) {
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
