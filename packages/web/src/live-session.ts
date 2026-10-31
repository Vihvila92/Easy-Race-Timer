// SPDX-License-Identifier: AGPL-3.0-only

/** Server close code when the device token expired. See sync-v1. */
export const SESSION_EXPIRED_CLOSE = 4401

/** First reconnect wait before jitter. Later attempts double this. */
export const RECONNECT_BASE_MS = 500

/** Longest reconnect wait. Jitter never exceeds it. */
export const RECONNECT_MAX_MS = 10_000

/** How long a socket must stay open before the backoff counter returns to zero. */
export const STABLE_OPEN_MS = 5_000

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
  /** `reconnecting` while the socket is down or the browser is offline. `connected` when it is usable again. */
  onStatus?: (status: LiveConnection) => void
  /** Returns a delay in `[0, 1]`. Values outside that range are clamped. */
  random?: () => number
  /** Arm a timer. The returned function cancels it. */
  schedule?: (callback: () => void, delayMs: number) => () => void
  /** `online` and `offline` follow the browser network events. `visible` fires when the page is shown again. */
  subscribe?: (kind: 'online' | 'offline' | 'visible', listener: () => void) => () => void
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

function defaultSubscribe(kind: 'online' | 'offline' | 'visible', listener: () => void): () => void {
  if (kind === 'online' || kind === 'offline') {
    if (typeof window === 'undefined') return () => undefined
    window.addEventListener(kind, listener)
    return () => window.removeEventListener(kind, listener)
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
  private cancelRetry: (() => void) | null = null
  private cancelStable: (() => void) | null = null
  private unsubOnline: (() => void) | null = null
  private unsubOffline: (() => void) | null = null
  private unsubVisible: (() => void) | null = null
  private readonly random: () => number
  private readonly schedule: (callback: () => void, delayMs: number) => () => void
  private readonly subscribe: (kind: 'online' | 'offline' | 'visible', listener: () => void) => () => void

  constructor(private readonly options: LiveSessionOptions) {
    this.random = options.random ?? Math.random
    this.schedule = options.schedule ?? defaultSchedule
    this.subscribe = options.subscribe ?? defaultSubscribe
  }

  /** Opens one socket. A second call, a call during backoff, or a call after 4401, does nothing. */
  start(): void {
    if (this.socket || this.held || this.stopping || this.cancelRetry) return
    this.listen()
    this.openSocket()
  }

  /** A new PIN login. Clears the 4401 hold and opens one socket. */
  resume(): void {
    this.held = false
    this.stopping = false
    this.attempt = 0
    this.clearRetry()
    this.clearStable()
    this.listen()
    this.openSocket()
  }

  /** Drop the socket without treating the close as expiry or as a reason to retry. */
  stop(): void {
    this.stopping = true
    this.clearRetry()
    this.clearStable()
    this.unlisten()
    const socket = this.socket
    this.socket = null
    socket?.close()
  }

  private listen(): void {
    if (this.unsubOnline) return
    this.unsubOnline = this.subscribe('online', () => this.wake('online'))
    this.unsubOffline = this.subscribe('offline', () => this.noteOffline())
    this.unsubVisible = this.subscribe('visible', () => this.wake('visible'))
  }

  private unlisten(): void {
    this.unsubOnline?.()
    this.unsubOffline?.()
    this.unsubVisible?.()
    this.unsubOnline = null
    this.unsubOffline = null
    this.unsubVisible = null
  }

  /** The socket can stay open after the browser reports offline, so the notice cannot wait for close. */
  private noteOffline(): void {
    if (this.held || this.stopping) return
    this.options.onStatus?.('reconnecting')
  }

  /**
   * Skip the backoff wait. An open socket is refreshed instead of replaced.
   * Coming back online clears the notice when that socket is still open.
   */
  private wake(source: 'online' | 'visible'): void {
    if (this.held || this.stopping) return
    if (this.socket) {
      this.options.onResync?.()
      if (source === 'online') this.options.onStatus?.('connected')
      return
    }
    this.clearRetry()
    this.openSocket()
  }

  private openSocket(): void {
    if (this.socket || this.held || this.stopping) return
    const socket = this.options.open()
    this.socket = socket
    socket.onOpen(() => {
      if (this.socket !== socket || this.stopping) return
      const reconnecting = this.attempt > 0
      this.options.onStatus?.('connected')
      if (reconnecting) this.options.onResync?.()
      this.armStable(socket)
    })
    socket.onMessage((data) => {
      if (this.socket !== socket || this.stopping || this.held) return
      this.settleAttempt(socket)
      if (isRefreshMessage(data)) this.options.onResync?.()
    })
    socket.onClose((code) => {
      if (this.socket !== socket) return
      this.socket = null
      this.clearStable()
      if (this.stopping) return
      if (code === SESSION_EXPIRED_CLOSE) {
        this.held = true
        this.clearRetry()
        this.options.onExpired()
        return
      }
      this.options.onStatus?.('reconnecting')
      this.armRetry()
    })
  }

  /** A handshake alone is not a stable connection. Wait for traffic or for the socket to stay open. */
  private armStable(socket: LiveSocket): void {
    this.clearStable()
    this.cancelStable = this.schedule(() => {
      this.cancelStable = null
      this.settleAttempt(socket)
    }, STABLE_OPEN_MS)
  }

  private settleAttempt(socket: LiveSocket): void {
    if (this.socket !== socket) return
    this.attempt = 0
    this.clearStable()
  }

  private armRetry(): void {
    this.clearRetry()
    const delay = reconnectDelayMs(this.attempt, this.random)
    this.attempt += 1
    this.cancelRetry = this.schedule(() => {
      this.cancelRetry = null
      this.openSocket()
    }, delay)
  }

  private clearRetry(): void {
    this.cancelRetry?.()
    this.cancelRetry = null
  }

  private clearStable(): void {
    this.cancelStable?.()
    this.cancelStable = null
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
