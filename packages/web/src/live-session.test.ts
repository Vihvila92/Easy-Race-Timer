// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { LiveSession, SESSION_EXPIRED_CLOSE, type LiveSocket } from './live-session.js'

class FakeSocket implements LiveSocket {
  private listener: ((code: number) => void) | null = null
  private closed = false

  onClose(listener: (code: number) => void): void {
    this.listener = listener
  }

  close(): void {
    this.emit(1000)
  }

  emit(code: number): void {
    if (this.closed) return
    this.closed = true
    this.listener?.(code)
  }
}

describe('live session', () => {
  it('shows the PIN gate on close 4401 and does not reconnect until a new PIN login', () => {
    const opened: FakeSocket[] = []
    let pinGate = false
    const session = new LiveSession({
      open: () => {
        const socket = new FakeSocket()
        opened.push(socket)
        return socket
      },
      onExpired: () => {
        pinGate = true
      },
    })

    session.start()
    session.start()
    expect(opened).toHaveLength(1)
    expect(pinGate).toBe(false)

    opened[0]?.emit(SESSION_EXPIRED_CLOSE)
    expect(pinGate).toBe(true)
    expect(opened).toHaveLength(1)

    session.start()
    session.start()
    expect(opened).toHaveLength(1)

    session.resume()
    expect(opened).toHaveLength(2)
    expect(pinGate).toBe(true)
  })

  it('does not treat a dropped socket or our own close as an expired session', () => {
    const opened: FakeSocket[] = []
    let pinGate = false
    const session = new LiveSession({
      open: () => {
        const socket = new FakeSocket()
        opened.push(socket)
        return socket
      },
      onExpired: () => {
        pinGate = true
      },
    })

    session.start()
    opened[0]?.emit(1006)
    expect(pinGate).toBe(false)
    expect(opened).toHaveLength(1)

    session.resume()
    expect(opened).toHaveLength(2)
    session.stop()
    expect(pinGate).toBe(false)
    session.start()
    expect(opened).toHaveLength(2)
    session.resume()
    expect(opened).toHaveLength(3)
  })
})
