// SPDX-License-Identifier: AGPL-3.0-only
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1'])

export function parseHost(header: string | undefined): { hostname: string; port: number | null } | null {
  if (!header) return null
  const value = header.trim().toLowerCase()
  if (!value || value.includes('/')) return null
  if (value.startsWith('[')) {
    const match = /^\[([^\]]+)\](?::(\d+))?$/.exec(value)
    if (!match) return null
    const port = match[2] ? Number(match[2]) : null
    if (port != null && (!Number.isInteger(port) || port < 1 || port > 65535)) return null
    return { hostname: match[1], port }
  }
  const parts = value.split(':')
  if (parts.length > 2 || !parts[0]) return null
  const port = parts[1] ? Number(parts[1]) : null
  if (port != null && (!Number.isInteger(port) || port < 1 || port > 65535)) return null
  return { hostname: parts[0], port }
}

/** Desktop mode accepts only `127.0.0.1`, never `localhost` or another loopback name. */
export function desktopHostAllowed(header: string | undefined, listenPort: number | null): boolean {
  const parsed = parseHost(header)
  if (!parsed || parsed.hostname !== '127.0.0.1') return false
  if (listenPort == null) return true
  return (parsed.port ?? 80) === listenPort
}

/** Desktop mode accepts only `http://127.0.0.1:<port>`. */
export function desktopOriginAllowed(origin: string | undefined, listenPort: number | null): boolean {
  if (!origin) return false
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' || url.username || url.password || url.hostname !== '127.0.0.1') return false
  if (listenPort == null) return true
  const port = url.port ? Number(url.port) : 80
  return port === listenPort
}

/** Host must be loopback. Once the process is listening, the port has to match. */
export function hostAllowed(header: string | undefined, listenPort: number | null): boolean {
  const parsed = parseHost(header)
  if (!parsed || !LOOPBACK.has(parsed.hostname)) return false
  if (listenPort == null) return true
  const port = parsed.port ?? 80
  return port === listenPort
}

export function originAllowed(origin: string | undefined, listenPort: number | null, extras: string[] = []): boolean {
  if (!origin) return false
  if (extras.includes(origin)) return true
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (url.username || url.password) return false
  if (!LOOPBACK.has(url.hostname)) return false
  if (listenPort == null) return true
  const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80)
  return port === listenPort
}

export function jsonContentType(header: string | undefined): boolean {
  if (!header) return false
  return header.split(';')[0]?.trim().toLowerCase() === 'application/json'
}

export function allowedOriginsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.ERT_ALLOWED_ORIGINS ?? '').split(',').map((item) => item.trim()).filter(Boolean)
}
