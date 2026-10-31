// SPDX-License-Identifier: AGPL-3.0-only

export type KeyLogEvent = 'unlock ok' | 'unlock failed' | 'unlock backoff'

const SECRET_KEYS = [
  'password',
  'newPassword',
  'currentPassword',
  'recoveryKey',
  'recovery_key',
  'dek',
  'dataKey',
  'data_key',
  'kek',
  'key',
  'pin',
  'authorization',
  'cookie',
  'token',
] as const

const SECRET = new Set<string>(SECRET_KEYS)

export function pinoRedactPaths(): string[] {
  const paths: string[] = []
  for (const name of SECRET_KEYS) paths.push(name, `*.${name}`, `*.*.${name}`, `*.*.*.${name}`)
  return paths
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value instanceof Error) return redactValue({ name: value.name, message: value.message }, seen)
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return null
  seen.add(value)
  if (Buffer.isBuffer(value)) return value.toString('utf8')
  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen))
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET.has(key) ? '[Redacted]' : redactValue(item, seen)
  }
  return out
}

/** Crash serializer. Secret fields are replaced. The result is safe to log. */
export function redactCrash(value: unknown): string {
  return JSON.stringify(redactValue(value, new WeakSet()))
}

let keyLogger: (event: KeyLogEvent, fields: { failureCount?: number }) => void = (event, fields) => {
  if (fields.failureCount === undefined) console.info(event)
  else console.info(event, fields.failureCount)
}

export function setKeyLogger(logger: ((event: KeyLogEvent, fields: { failureCount?: number }) => void) | null): void {
  keyLogger = logger ?? ((event, fields) => {
    if (fields.failureCount === undefined) console.info(event)
    else console.info(event, fields.failureCount)
  })
}

export function logUnlock(event: KeyLogEvent, failureCount?: number): void {
  keyLogger(event, failureCount === undefined ? {} : { failureCount })
}
