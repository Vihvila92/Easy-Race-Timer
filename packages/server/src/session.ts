// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { AppDb } from '@ert/storage'

export const SESSION_COOKIE = 'ert_session'
export const SESSION_TTL_SECONDS = 12 * 60 * 60

export function sessionSecret(db: AppDb): string {
  db.raw.exec(`CREATE TABLE IF NOT EXISTS server_secret (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    secret TEXT NOT NULL
  )`)
  const existing = db.get<{ secret: string }>('SELECT secret FROM server_secret WHERE id = 1')
  if (existing?.secret) return existing.secret
  const secret = randomBytes(32).toString('hex')
  db.run('INSERT INTO server_secret (id, secret) VALUES (1, ?)', secret)
  return secret
}

export function issueToken(secret: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ exp: now + SESSION_TTL_SECONDS * 1000 })).toString('base64url')
  const sig = createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${sig}`
}

function tokenPayload(token: string): { exp?: number } | null {
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  try {
    const payload = JSON.parse(Buffer.from(token.slice(0, dot), 'base64url').toString()) as { exp?: number }
    return payload && typeof payload === 'object' ? payload : null
  } catch {
    return null
  }
}

export function verifyToken(secret: string, token: string | undefined, now = Date.now()): boolean {
  if (!token) return false
  const dot = token.indexOf('.')
  if (dot <= 0) return false
  const body = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = createHmac('sha256', secret).update(body).digest('base64url')
  const left = Buffer.from(sig)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) return false
  const payload = tokenPayload(token)
  return typeof payload?.exp === 'number' && payload.exp > now
}

/** Expiry of a token that is valid at `now`, or null when the token is missing, forged, or already expired. */
export function tokenExpiry(secret: string, token: string | undefined, now = Date.now()): number | null {
  if (!token || !verifyToken(secret, token, now)) return null
  const exp = tokenPayload(token)?.exp
  return typeof exp === 'number' ? exp : null
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}`
}

function sessionCookieValue(cookie: string): string | undefined {
  const match = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]*)`).exec(cookie)
  const raw = match?.[1]
  if (!raw) return undefined
  try {
    return decodeURIComponent(raw)
  } catch {
    // A truncated or non-decodable cookie is not a token. Callers treat that as anonymous.
    return undefined
  }
}

export function tokenFromRequest(headers: { authorization?: string; cookie?: string }): string | undefined {
  const header = headers.authorization
  if (header?.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim()
    if (token) return token
  }
  const cookie = headers.cookie
  if (!cookie) return undefined
  return sessionCookieValue(cookie)
}
