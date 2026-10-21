export type Access = 'public' | 'protected' | 'local'

/** Routes that answer without a device token. Anything not listed is refused. */
export const PUBLIC_ROUTES = [
  'GET /api/v1/health',
  'GET /api/v1/time',
  'POST /api/v1/settings/pin/check',
  'GET /api/v1/results',
  'GET /api/v1/club-stats',
] as const

/** Loopback may read these without a token. Other clients need a device token. */
export const LOCAL_ROUTES = [
  'GET /api/v1/runtime',
] as const

export const PROTECTED_ROUTES = [
  'POST /api/v1/test/clock',
  'GET /api/v1/bootstrap',
  'POST /api/v1/events/import',
  'POST /api/v1/clubs/import',
  'GET /api/v1/clubs',
  'GET /api/v1/clubs/duplicates',
  'POST /api/v1/clubs',
  'POST /api/v1/clubs/:id/merge',
  'POST /api/v1/clubs/:id/unmerge',
  'POST /api/v1/entries/import/preview',
  'POST /api/v1/entries/import',
  'GET /api/v1/suggestions',
  'POST /api/v1/settings/age-basis',
  'POST /api/v1/settings/offset-policy',
  'POST /api/v1/settings/pin',
  'POST /api/v1/entries/late',
  'POST /api/v1/entries/change-bib',
  'POST /api/v1/entries/status',
  'POST /api/v1/entries/offset',
  'POST /api/v1/entries/race',
  'POST /api/v1/club-actions/confirm',
  'POST /api/v1/club-actions/conflict',
  'POST /api/v1/races/:id/start',
  'POST /api/v1/timing-events',
  'POST /api/v1/corrections/assign-bib',
  'POST /api/v1/corrections/void',
  'POST /api/v1/corrections/restore',
  'POST /api/v1/corrections/copy-time',
  'GET /api/v1/timing-events',
  'GET /api/v1/ties',
  'POST /api/v1/ties/confirm',
  'POST /api/v1/ties/undo',
  'GET /api/v1/races/:id/lock-blockers',
  'POST /api/v1/races/:id/lock',
  'POST /api/v1/races/:id/unlock',
  'GET /api/v1/audit',
  'POST /api/v1/plaintext-quarantine/delete',
  'POST /api/v1/retention/run',
  'GET /api/v1/persons/:id/export',
  'POST /api/v1/persons/:id/publication',
  'POST /api/v1/persons/:id/consents',
  'GET /api/v1/sync/export',
  'POST /api/v1/sync/import',
  'GET /ws',
] as const

const PUBLIC = new Set<string>(PUBLIC_ROUTES)
const LOCAL = new Set<string>(LOCAL_ROUTES)
const PROTECTED = new Set<string>(PROTECTED_ROUTES)

export function routeAccess(method: string, url: string): Access | undefined {
  const key = `${method} ${url}`
  if (PUBLIC.has(key)) return 'public'
  if (LOCAL.has(key)) return 'local'
  if (PROTECTED.has(key)) return 'protected'
  return undefined
}

export function isLoopbackAddress(ip: string | undefined): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
}
