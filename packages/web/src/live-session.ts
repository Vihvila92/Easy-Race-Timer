// SPDX-License-Identifier: AGPL-3.0-only

/** Server close code when the device token expired. See sync-v1. */
export const SESSION_EXPIRED_CLOSE = 4401

export interface LiveSocket {
  close(): void
  onClose(listener: (code: number) => void): void
}

export interface LiveSessionOptions {
  open: () => LiveSocket
  /** PIN gate. Called once when the server closes this socket with 4401. */
  onExpired: () => void
}

/**
 * One live socket after a successful login.
 * Close code 4401 shows the PIN gate and holds the socket shut until `resume` (a new PIN login).
 * Any other close, including our own `stop`, does not open another socket.
 */
export class LiveSession {
  private socket: LiveSocket | null = null
  private held = false
  private stopping = false

  constructor(private readonly options: LiveSessionOptions) {}

  /** Opens one socket. A second call, or a call after 4401, does nothing. */
  start(): void {
    if (this.socket || this.held || this.stopping) return
    const socket = this.options.open()
    this.socket = socket
    socket.onClose((code) => {
      if (this.socket !== socket) return
      this.socket = null
      if (this.stopping) return
      if (code === SESSION_EXPIRED_CLOSE) {
        this.held = true
        this.options.onExpired()
      }
    })
  }

  /** A new PIN login. Clears the 4401 hold and opens one socket. */
  resume(): void {
    this.held = false
    this.stopping = false
    this.start()
  }

  /** Drop the socket without treating the close as expiry. */
  stop(): void {
    this.stopping = true
    const socket = this.socket
    this.socket = null
    socket?.close()
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
    onClose(listener) {
      socket.addEventListener('close', (event) => listener(event.code))
    },
  }
}
