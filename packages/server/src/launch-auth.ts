import { timingSafeEqual } from 'node:crypto'

export const LAUNCH_COOKIE = 'ert_launch'
export const AUTH_CODE_TTL_MS = 15_000

/** 32 bytes, hex encoded. Used for the stdin launch token and the one-time auth code. */
export function isLaunchToken(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value)
}

/** Constant-time compare of two equal-length strings. Different lengths do not match. */
export function tokensEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** Session cookie: no Max-Age and no Expires, so it ends with the browser session. */
export function launchCookie(token: string): string {
  return `${LAUNCH_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`
}

export function redactRequestUrl(url: string): string {
  const query = url.indexOf('?')
  return query === -1 ? url : url.slice(0, query)
}

/** Bearer launch token, or the `ert_launch` cookie. A PIN bearer token does not match. */
export function launchCredentialMatches(expected: string, headers: { authorization?: string; cookie?: string }): boolean {
  const header = headers.authorization
  if (header?.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim()
    if (token && tokensEqual(token, expected)) return true
  }
  const cookie = headers.cookie
  if (!cookie) return false
  const match = new RegExp(`(?:^|;\\s*)${LAUNCH_COOKIE}=([^;]+)`).exec(cookie)
  if (!match?.[1]) return false
  try {
    return tokensEqual(decodeURIComponent(match[1]), expected)
  } catch {
    return false
  }
}

/** One-time code exchanged at `GET /auth` for the launch cookie. */
export class LaunchCodes {
  readonly code: string
  private remaining: string
  private readonly expiresAt: number

  constructor(code: string, now = Date.now(), ttlMs = AUTH_CODE_TTL_MS) {
    if (!isLaunchToken(code)) throw new Error('Invalid auth code')
    this.code = code
    this.remaining = code
    this.expiresAt = now + ttlMs
  }

  consume(presented: string, now = Date.now()): boolean {
    const expected = this.remaining
    if (!expected || now > this.expiresAt) {
      this.remaining = ''
      return false
    }
    if (!tokensEqual(presented, expected)) return false
    this.remaining = ''
    return true
  }
}

/**
 * Read one launch-token line from stdin.
 * A TTY, or EOF before any line, means the developer server: no token.
 * The stream stays open after a valid line so a later EOF can stop the process.
 */
export function readLaunchHandshake(stdin: NodeJS.ReadStream): Promise<string | null> {
  if (stdin.isTTY) return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    let buffer = ''
    let settled = false
    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      stdin.off('data', onData)
      resolve(value)
    }
    const fail = () => {
      if (settled) return
      settled = true
      stdin.off('data', onData)
      reject(new Error('Invalid launch token'))
    }
    const onData = (chunk: string) => {
      if (settled) return
      buffer += chunk
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      const line = buffer.slice(0, newline).trim()
      if (!isLaunchToken(line)) {
        fail()
        return
      }
      finish(line)
    }
    stdin.setEncoding('utf8')
    stdin.on('data', onData)
    stdin.on('end', () => {
      if (settled) return
      if (buffer.trim() === '') finish(null)
      else fail()
    })
    stdin.resume()
  })
}
