/** Payload the desktop shell reads from one stdout line. */
export interface ReadyPayload {
  url: string
  dataDir: string
  dbPath: string
  /** Present only when the shell passed a launch token. Never log this value. */
  authCode?: string
}

/**
 * One stdout line: `ERT_READY` plus JSON (`url`, `dataDir`, `dbPath`, and
 * `authCode` when a launch token was read). The Tauri shell parses the same
 * shape in `src-tauri/src/ready.rs` and requires `authCode`.
 */
export function formatReadyLine(payload: ReadyPayload): string {
  const body: Record<string, string> = { url: payload.url, dataDir: payload.dataDir, dbPath: payload.dbPath }
  if (payload.authCode) body.authCode = payload.authCode
  return `ERT_READY ${JSON.stringify(body)}`
}

/** Accept only `http://127.0.0.1:<port>` with an optional trailing slash. */
export function parseReadyLine(line: string): ReadyPayload | null {
  const trimmed = line.trim()
  const json = trimmed.startsWith('ERT_READY ') ? trimmed.slice('ERT_READY '.length).trim() : ''
  if (!json) return null
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.url !== 'string' || typeof record.dataDir !== 'string' || typeof record.dbPath !== 'string') return null
  if (!record.dataDir || !record.dbPath) return null
  const url = loopbackUrl(record.url)
  if (!url) return null
  if (record.authCode !== undefined) {
    if (typeof record.authCode !== 'string' || !/^[0-9a-f]{64}$/.test(record.authCode)) return null
    return { url, dataDir: record.dataDir, dbPath: record.dbPath, authCode: record.authCode }
  }
  return { url, dataDir: record.dataDir, dbPath: record.dbPath }
}

function loopbackUrl(raw: string): string | null {
  const value = raw.trim()
  const prefix = 'http://127.0.0.1:'
  if (!value.startsWith(prefix)) return null
  const match = /^(\d+)(\/)?$/.exec(value.slice(prefix.length))
  if (!match?.[1]) return null
  const digits = match[1]
  if (digits.length > 5 || (digits.length > 1 && digits.startsWith('0'))) return null
  const port = Number(digits)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return `http://127.0.0.1:${port}${match[2] ?? ''}`
}
