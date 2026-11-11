// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod'
import { AppError, resultProjection } from '@ert/core'
import { plaintextQuarantinePending } from '@ert/storage'
import { isLoopbackAddress } from './access.js'
import { workspace, type HttpCtx } from './http-context.js'
import { issueToken, sessionCookie } from './session.js'
import type { RaceService } from './service.js'

const clockBody = z.object({ at: z.string().nullable().optional() })

function retentionMoment(body: { at?: unknown }, testMode: boolean | undefined, now: number): number | { error: string } {
  if (body.at !== undefined && !testMode) return { error: 'at is only available in test mode' }
  if (body.at !== undefined && typeof body.at !== 'string') throw new AppError('VALIDATION_ERROR', 'at must be a time')
  const parsed = typeof body.at === 'string' ? Date.parse(body.at) : now
  if (Number.isNaN(parsed)) throw new AppError('VALIDATION_ERROR', 'at is not a valid time')
  return parsed
}

function registerRoutes0(ctx: HttpCtx): void {
  const { app, service, options, clock, strictLimit, slot } = ctx
  app.get('/api/v1/health', async () => ({
    ok: true,
    version: '0.1.0',
    pinConfigured: service.pinConfigured(),
    plaintextQuarantine: plaintextQuarantinePending(slot.current.filePath),
  }))
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
  app.post('/api/v1/events/import', strictLimit, async (request) => service.importEvent(request.body as Record<string, unknown>))
  app.post('/api/v1/clubs/import', strictLimit, async (request) => {
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
}

function registerRoutes1(ctx: HttpCtx): void {
  const { app, service, strictLimit, secretBox } = ctx
  app.post('/api/v1/clubs/:id/unmerge', async (request) => {
    const body = request.body as { reason: string }
    return service.undoMerge((request.params as { id: string }).id, body.reason)
  })
  app.post('/api/v1/entries/import/preview', strictLimit, async (request) => service.previewCsv((request.body as { csv: string }).csv))
  app.post('/api/v1/entries/import', strictLimit, async (request) => service.importCsv((request.body as { csv: string }).csv))
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
    const body = request.body as { pin: string; currentPin?: string }
    service.setPin(body.pin, body.currentPin)
    return { ok: true }
  })
  app.post('/api/v1/settings/pin/check', strictLimit, async (request, reply) => {
    const body = (request.body as { pin?: string } | undefined) ?? {}
    if (!service.pinConfigured() && !isLoopbackAddress(request.ip)) {
      throw new AppError('PIN_REQUIRED', 'PIN required')
    }
    service.checkPin(body.pin)
    const token = issueToken(secretBox.current)
    reply.header('set-cookie', sessionCookie(token))
    return { ok: true, token }
  })
  app.post('/api/v1/entries/late', async (request) => service.registerLate(request.body as Parameters<RaceService['registerLate']>[0]))
  app.post('/api/v1/entries/change-bib', async (request) => {
    const body = request.body as { bibFrom: number; bibTo: number; reason: string }
    service.changeBib(body.bibFrom, body.bibTo, body.reason)
    return { ok: true }
  })
}

function registerRoutes2(ctx: HttpCtx): void {
  const { app, service, clock, recordingLimit } = ctx
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
  app.post('/api/v1/races/:id/start', recordingLimit, async (request) => {
    const body = request.body as { timeMs?: number; confirm?: boolean }
    return service.startRace((request.params as { id: string }).id, body.timeMs ?? clock.now(), Boolean(body.confirm))
  })
  app.post('/api/v1/timing-events', recordingLimit, async (request) => {
    const body = request.body as { id?: string; timeMs: number; deviceTimeMs?: number; bib?: number | null; mode?: string; deviceId?: string; label?: string }
    return service.recordFinish({
      id: body.id,
      timeMs: body.timeMs,
      deviceTimeMs: typeof body.deviceTimeMs === 'number' ? body.deviceTimeMs : undefined,
      bib: body.bib,
      mode: body.mode,
      deviceId: body.deviceId,
      label: body.label,
    })
  })
}

function registerRoutes3(ctx: HttpCtx): void {
  const { app, service, requireBackup } = ctx
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
}

function registerRoutes4(ctx: HttpCtx): void {
  const { app, service, options, clock, strictLimit, authenticated, requireBackup } = ctx
  app.post('/api/v1/races/:id/unlock', async (request) => {
    const body = request.body as { reason: string }
    service.unlockRace((request.params as { id: string }).id, body.reason)
    return { ok: true }
  })
  app.get('/api/v1/results', async (request, reply) => {
    const query = request.query as { format?: string; view?: 'public' | 'internal' }
    const view = query.view ?? 'public'
    if (view === 'internal' && !authenticated(request)) {
      throw new AppError('PIN_REQUIRED', 'PIN required')
    }
    if (query.format === 'csv') {
      reply.header('content-type', 'text/csv; charset=utf-8')
      return service.resultsCsv(view)
    }
    if (query.format === 'html') {
      reply.header('content-type', 'text/html; charset=utf-8')
      const locale = (request.query as { locale?: string }).locale
      return service.resultsHtml(locale === 'en' || locale === 'fi' ? locale : undefined)
    }
    const rows = service.results(view)
    return view === 'internal' ? rows : rows.map(resultProjection)
  })
  app.get('/api/v1/club-stats', async () => service.clubStatistics())
  app.get('/api/v1/audit', async () => service.audit())
  app.post('/api/v1/plaintext-quarantine/delete', strictLimit, async (request, reply) => {
    const body = (request.body as { confirm?: unknown } | undefined) ?? {}
    if (body.confirm !== true) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'confirm: true is required' } })
    }
    return service.deletePlaintextQuarantine()
  })
  app.post('/api/v1/retention/run', strictLimit, async (request, reply) => {
    const body = (request.body as { at?: unknown; confirm?: boolean } | undefined) ?? {}
    const now = retentionMoment(body, options.testMode, clock.now())
    if (typeof now !== 'number') return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: now.error } })
    const preview = service.previewRetention(now)
    if (!body.confirm) return preview
    if (!preview.locked) throw new AppError('LOCK_BLOCKED', 'Retention requires every race to be locked')
    if (!preview.deadline_passed) throw new AppError('VALIDATION_ERROR', 'Retention deadline has not passed')
    await requireBackup('retention')
    return service.runRetention(now)
  })
}

function registerRoutes5(ctx: HttpCtx): void {
  const { app, service, strictLimit, requireBackup } = ctx
  app.get('/api/v1/persons/:id/export', async (request) => service.exportPerson((request.params as { id: string }).id))
  app.post('/api/v1/persons/:id/publication', async (request) => {
    const body = request.body as { level?: string }
    service.setPublication((request.params as { id: string }).id, String(body.level ?? ''))
    return { ok: true }
  })
  app.post('/api/v1/persons/:id/consents', async (request) => {
    const recorded = service.recordConsent((request.params as { id: string }).id, request.body)
    return { ok: true, id: recorded.id }
  })
  app.get('/api/v1/sync/export', async (_request, reply) => {
    reply.header('content-type', 'application/zip')
    return service.exportErtx()
  })
  app.post('/api/v1/sync/import', strictLimit, async (request) => {
    const body = (request.body ?? {}) as { base64?: string; confirm?: boolean }
    if (typeof body.base64 !== 'string' || body.base64.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'base64 is required')
    }
    const bytes = Buffer.from(body.base64, 'base64')
    const preview = await service.previewErtx(bytes)
    if (!body.confirm) return preview
    await requireBackup('import')
    await service.importErtx(bytes)
    return { ok: true }
  })
}

export function registerRaceRoutes(ctx: HttpCtx): void {
  registerRoutes0(ctx)
  registerRoutes1(ctx)
  registerRoutes2(ctx)
  registerRoutes3(ctx)
  registerRoutes4(ctx)
  registerRoutes5(ctx)
}
