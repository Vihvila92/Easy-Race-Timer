// SPDX-License-Identifier: AGPL-3.0-only

/** Server close code when the device token expired. See sync-v1. */
export const SESSION_EXPIRED_CLOSE = 4401

/** First reconnect wait before jitter. Later attempts double this. */
export const RECONNECT_BASE_MS = 500

/** Longest reconnect wait. Jitter never exceeds it. */
export const RECONNECT_MAX_MS = 10_000

const REFRESH_TYPES = new Set(['timing_event.created', 'correction.created', 'results.updated'])

export type LiveConnection = 'connected' | 'reconnecting'

export interface LiveSocket {
  close(): void
  onOpen(listener: () => void): void
  onMessage(listener: (data: string) => void): void
  onClose(listener: (code: number) => void): void
}

export interface LiveSessionOptions {
  open: () => LiveSocket
  /** PIN gate. Called once when the server closes this socket with 4401. */
  onExpired: () => void
  /** Reload the workspace. Called after a reconnect and on a refresh notification. */
  onResync?: () => void
  /** `reconnecting` after a non-4401 close, `connected` when the next socket opens. */
  onStatus?: (status: LiveConnection) => void
  /** Returns a delay in `[0, 1]`. Values outside that range are clamped. */
  random?: () => number
  /** Arm a retry. The returned function cancels it. */
  schedule?: (callback: () => void, delayMs: number) => () => void
  /** `online` fires on the browser online event. `visible` fires when the page is shown again. */
  subscribe?: (kind: 'online' | 'visible', listener: () => void) => () => void
}

/**
 * Delay before reconnect attempt `attempt` (0-based).
 * The nominal wait is 500 ms and doubles until 10 s. Jitter scales that wait by 0.5–1.
 */
export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const step = Math.max(0, Math.floor(attempt))
  const nominal = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.min(step, 20))
  const factor = 0.5 + 0.5 * clamp01(random())
  return Math.round(nominal * factor)
}

/** True for a websocket refresh notification. `device.status` and malformed text are not. */
export function isRefreshMessage(data: string): boolean {
  try {
    const parsed = JSON.parse(data) as { type?: unknown }
    return typeof parsed.type === 'string' && REFRESH_TYPES.has(parsed.type)
  } catch {
    return false
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function defaultSchedule(callback: () => void, delayMs: number): () => void {
  const id = setTimeout(callback, delayMs)
  return () => clearTimeout(id)
}

function defaultSubscribe(kind: 'online' | 'visible', listener: () => void): () => void {
  if (kind === 'online') {
    if (typeof window === 'undefined') return () => undefined
    window.addEventListener('online', listener)
    return () => window.removeEventListener('online', listener)
  }
  if (typeof document === 'undefined') return () => undefined
  const onVisibility = () => {
    if (document.visibilityState === 'visible') listener()
  }
  document.addEventListener('visibilitychange', onVisibility)
  return () => document.removeEventListener('visibilitychange', onVisibility)
}

/**
 * One live socket after a successful login.
 * Close code 4401 shows the PIN gate and holds the socket shut until `resume` (a new PIN login).
 * Any other close retries with exponential backoff while the page is open.
 * `stop` drops the socket and does not open another one.
 */
export class LiveSession {
  private socket: LiveSocket | null = null
  private held = false
  private stopping = false
  private attempt = 0
  private cancelTimer: (() => void) | null = null
  private unsubOnline: (() => void) | null = null
  private unsubVisible: (() => void) | null = null
  private readonly random: () => number
  private readonly schedule: (callback: () => void, delayMs: number) => () => void
  private readonly subscribe: (kind: 'online' | 'visible', listener: () => void) => () => void

  constructor(private readonly options: LiveSessionOptions) {
    this.random = options.random ?? Math.random
    this.schedule = options.schedule ?? defaultSchedule
    this.subscribe = options.subscribe ?? defaultSubscribe
  }

  /** Opens one socket. A second call, a call during backoff, or a call after 4401, does nothing. */
  start(): void {
    if (this.socket || this.held || this.stopping || this.cancelTimer) return
    this.listen()
    this.openSocket()
  }

  /** A new PIN login. Clears the 4401 hold and opens one socket. */
  resume(): void {
    this.held = false
    this.stopping = false
    this.attempt = 0
    this.clearTimer()
    this.listen()
    this.openSocket()
  }

  /** Drop the socket without treating the close as expiry or as a reason to retry. */
  stop(): void {
    this.stopping = true
    this.clearTimer()
    this.unlisten()
    const socket = this.socket
    this.socket = null
    socket?.close()
  }

  private listen(): void {
    if (this.unsubOnline) return
    this.unsubOnline = this.subscribe('online', () => this.wake())
    this.unsubVisible = this.subscribe('visible', () => this.wake())
  }

  private unlisten(): void {
    this.unsubOnline?.()
    this.unsubVisible?.()
    this.unsubOnline = null
    this.unsubVisible = null
  }

  /** Skip the backoff wait. An open socket is refreshed instead of replaced. */
  private wake(): void {
    if (this.held || this.stopping) return
    if (this.socket) {
      this.options.onResync?.()
      return
    }
    this.clearTimer()
    this.openSocket()
  }

  private openSocket(): void {
    if (this.socket || this.held || this.stopping) return
    const socket = this.options.open()
    this.socket = socket
    socket.onOpen(() => {
      if (this.socket !== socket || this.stopping) return
      const reconnecting = this.attempt > 0
      this.attempt = 0
      this.options.onStatus?.('connected')
      if (reconnecting) this.options.onResync?.()
    })
    socket.onMessage((data) => {
      if (this.socket !== socket || this.stopping || this.held) return
      if (isRefreshMessage(data)) this.options.onResync?.()
    })
    socket.onClose((code) => {
      if (this.socket !== socket) return
      this.socket = null
      if (this.stopping) return
      if (code === SESSION_EXPIRED_CLOSE) {
        this.held = true
        this.clearTimer()
        this.options.onExpired()
        return
      }
      this.options.onStatus?.('reconnecting')
      this.armRetry()
    })
  }

  private armRetry(): void {
    this.clearTimer()
    const delay = reconnectDelayMs(this.attempt, this.random)
    this.attempt += 1
    this.cancelTimer = this.schedule(() => {
      this.cancelTimer = null
      this.openSocket()
    }, delay)
  }

  private clearTimer(): void {
    this.cancelTimer?.()
    this.cancelTimer = null
  }
}

/** Same-origin `/ws`. The page host is the server host; no address is hardcoded. */
export function openLiveSocket(): LiveSocket {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const socket = new WebSocket(`${scheme}//${location.host}/ws?proto=1`)
  socket.addEventListener('error', () => undefined)
  return {
    close() {
      socket.close()
    },
    onOpen(listener) {
      socket.addEventListener('open', () => listener())
    },
    onMessage(listener) {
      socket.addEventListener('message', (event) => {
        if (typeof event.data === 'string') listener(event.data)
      })
    },
    onClose(listener) {
      socket.addEventListener('close', (event) => listener(event.code))
    },
  }
}
