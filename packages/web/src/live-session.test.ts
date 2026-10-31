// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import {
  isRefreshMessage,
  LiveSession,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
  reconnectDelayMs,
  SESSION_EXPIRED_CLOSE,
  STABLE_OPEN_MS,
  type LiveConnection,
  type LiveSocket,
} from './live-session.js'

class FakeSocket implements LiveSocket {
  private closeListener: ((code: number) => void) | null = null
  private openListener: (() => void) | null = null
  private messageListener: ((data: string) => void) | null = null
  private closed = false

  onOpen(listener: () => void): void {
    this.openListener = listener
  }

  onMessage(listener: (data: string) => void): void {
    this.messageListener = listener
  }

  onClose(listener: (code: number) => void): void {
    this.closeListener = listener
  }

  close(): void {
    this.emit(1000)
  }

  open(): void {
    this.openListener?.()
  }

  message(data: string): void {
    this.messageListener?.(data)
  }

  emit(code: number): void {
    if (this.closed) return
    this.closed = true
    this.closeListener?.(code)
  }
}

function harness(random: () => number = () => 1) {
  const opened: FakeSocket[] = []
  const timers: { delay: number; active: boolean; run: () => void }[] = []
  const wakes: { kind: 'online' | 'offline' | 'visible'; fire: () => void }[] = []
  const statuses: LiveConnection[] = []
  const state = { pinGate: false, resyncs: 0 }
  const session = new LiveSession({
    open: () => {
      const socket = new FakeSocket()
      opened.push(socket)
      return socket
    },
    onExpired: () => {
      state.pinGate = true
    },
    onResync: () => {
      state.resyncs += 1
    },
    onStatus: (status) => {
      statuses.push(status)
    },
    random,
    schedule: (callback, delayMs) => {
      const timer = {
        delay: delayMs,
        active: true,
        run: () => {
          if (!timer.active) return
          timer.active = false
          callback()
        },
      }
      timers.push(timer)
      return () => {
        timer.active = false
      }
    },
    subscribe: (kind, listener) => {
      const wake = { kind, fire: listener }
      wakes.push(wake)
      return () => {
        const index = wakes.indexOf(wake)
        if (index >= 0) wakes.splice(index, 1)
      }
    },
  })
  const retryDelays = () => timers.map((timer) => timer.delay).filter((delay) => delay !== STABLE_OPEN_MS)
  const run = (delay: number) => {
    const timer = timers.find((item) => item.delay === delay && item.active)
    if (!timer) throw new Error(`no active timer for ${delay}`)
    timer.run()
  }
  const fire = (kind: 'online' | 'offline' | 'visible') => {
    const wake = wakes.find((item) => item.kind === kind)
    if (!wake) throw new Error(`no ${kind} listener`)
    wake.fire()
  }
  return { session, opened, timers, retryDelays, run, fire, statuses, state }
}

describe('reconnect delay', () => {
  it('doubles from 0.5s up to 10s and jitters between half and the full wait', () => {
    expect(reconnectDelayMs(0, () => 1)).toBe(500)
    expect(reconnectDelayMs(0, () => 0)).toBe(250)
    expect(reconnectDelayMs(1, () => 1)).toBe(1_000)
    expect(reconnectDelayMs(4, () => 1)).toBe(8_000)
    expect(reconnectDelayMs(5, () => 1)).toBe(10_000)
    expect(reconnectDelayMs(30, () => 1)).toBe(10_000)
    expect(reconnectDelayMs(30, () => 0)).toBe(5_000)
    expect(reconnectDelayMs(0, () => -5)).toBe(250)
    expect(reconnectDelayMs(0, () => Number.NaN)).toBe(250)

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const nominal = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.min(attempt, 20))
      const low = reconnectDelayMs(attempt, () => 0)
      const high = reconnectDelayMs(attempt, () => 1)
      const mid = reconnectDelayMs(attempt, () => 0.5)
      expect(high).toBe(nominal)
      expect(low).toBe(Math.round(nominal / 2))
      expect(mid).toBeGreaterThanOrEqual(low)
      expect(mid).toBeLessThanOrEqual(high)
      expect(high).toBeLessThanOrEqual(RECONNECT_MAX_MS)
    }
  })
})

describe('refresh messages', () => {
  it('accepts workspace notifications and ignores the hello frame and junk', () => {
    expect(isRefreshMessage('{"type":"timing_event.created","payload":{"id":"F1"}}')).toBe(true)
    expect(isRefreshMessage('{"type":"correction.created","payload":{"action":"void"}}')).toBe(true)
    expect(isRefreshMessage('{"type":"results.updated","payload":{}}')).toBe(true)
    expect(isRefreshMessage('{"type":"device.status","payload":{"proto":1}}')).toBe(false)
    expect(isRefreshMessage('{"type":"sync.conflict"}')).toBe(false)
    expect(isRefreshMessage('not-json')).toBe(false)
    expect(isRefreshMessage('{"type":1}')).toBe(false)
  })
})

describe('live session pin gate', () => {
  it('shows the PIN gate on close 4401 and does not reconnect until a new PIN login', () => {
    const { session, opened, timers, fire, state } = harness()

    session.start()
    session.start()
    expect(opened).toHaveLength(1)
    expect(state.pinGate).toBe(false)

    opened[0]?.emit(SESSION_EXPIRED_CLOSE)
    expect(state.pinGate).toBe(true)
    expect(opened).toHaveLength(1)
    expect(timers).toEqual([])

    session.start()
    session.start()
    fire('online')
    fire('offline')
    fire('visible')
    for (const timer of timers) timer.run()
    expect(opened).toHaveLength(1)
    expect(timers).toEqual([])

    session.resume()
    expect(opened).toHaveLength(2)
    expect(state.pinGate).toBe(true)
  })

})

describe('live session retry', () => {
  it('retries a dropped socket with backoff and stops when asked', () => {
    const { session, opened, retryDelays, run, timers, statuses, state } = harness()

    session.start()
    opened[0]?.open()
    expect(statuses).toEqual(['connected'])
    expect(state.resyncs).toBe(0)

    opened[0]?.emit(1006)
    expect(state.pinGate).toBe(false)
    expect(statuses.at(-1)).toBe('reconnecting')
    expect(retryDelays()).toEqual([500])
    expect(opened).toHaveLength(1)

    run(500)
    expect(opened).toHaveLength(2)
    opened[1]?.emit(1001)
    run(1_000)
    opened[2]?.emit(1006)
    expect(retryDelays()).toEqual([500, 1_000, 2_000])

    session.stop()
    expect(state.pinGate).toBe(false)
    for (const timer of timers) timer.run()
    session.start()
    expect(opened).toHaveLength(3)

    session.resume()
    expect(opened).toHaveLength(4)
  })

})

describe('live session unlimited retries', () => {
  it('keeps retrying without a cap', () => {
    const { session, opened, retryDelays, run } = harness()
    session.start()
    for (let attempt = 0; attempt < 8; attempt += 1) {
      opened.at(-1)?.emit(1006)
      run(retryDelays().at(-1) ?? 0)
    }
    expect(retryDelays()).toEqual([500, 1_000, 2_000, 4_000, 8_000, 10_000, 10_000, 10_000])
    expect(opened.length).toBeGreaterThan(8)
  })

})

describe('live session backoff reset', () => {
  it('does not reset backoff when the socket opens and closes immediately', () => {
    const { session, opened, retryDelays, run } = harness()
    session.start()
    opened[0]?.open()
    opened[0]?.emit(1006)
    run(500)
    opened[1]?.open()
    opened[1]?.emit(1006)
    run(1_000)
    opened[2]?.open()
    opened[2]?.emit(1006)
    expect(retryDelays()).toEqual([500, 1_000, 2_000])
  })

})

describe('live session stable connection', () => {
  it('resets backoff after the socket stays open or the first message arrives', () => {
    const stable = harness()
    stable.session.start()
    stable.opened[0]?.open()
    stable.opened[0]?.emit(1006)
    stable.run(500)
    stable.opened[1]?.open()
    stable.run(STABLE_OPEN_MS)
    stable.opened[1]?.emit(1006)
    expect(stable.retryDelays()).toEqual([500, 500])

    const messaged = harness()
    messaged.session.start()
    messaged.opened[0]?.open()
    messaged.opened[0]?.emit(1006)
    messaged.run(500)
    messaged.opened[1]?.open()
    messaged.opened[1]?.message('{"type":"device.status","payload":{"proto":1}}')
    messaged.opened[1]?.emit(1006)
    expect(messaged.retryDelays()).toEqual([500, 500])
  })

})

describe('live session wake', () => {
  it('reconnects immediately on online and when the page is visible again', () => {
    const { session, opened, retryDelays, run, fire, statuses, state } = harness()
    session.start()
    opened[0]?.open()
    opened[0]?.emit(1006)
    expect(retryDelays()).toEqual([500])

    fire('online')
    expect(opened).toHaveLength(2)
    expect(() => run(500)).toThrow(/no active timer/)
    expect(opened).toHaveLength(2)

    opened[1]?.open()
    expect(state.resyncs).toBe(1)
    expect(statuses.at(-1)).toBe('connected')

    const before = state.resyncs
    fire('visible')
    expect(opened).toHaveLength(2)
    expect(state.resyncs).toBe(before + 1)
  })

})

describe('live session offline', () => {
  it('shows the notice on offline and clears it when the open socket is usable again', () => {
    const { session, opened, fire, statuses, state } = harness()
    session.start()
    opened[0]?.open()
    expect(statuses).toEqual(['connected'])

    fire('offline')
    expect(statuses.at(-1)).toBe('reconnecting')
    expect(opened).toHaveLength(1)

    fire('visible')
    expect(statuses.at(-1)).toBe('reconnecting')
    expect(state.resyncs).toBe(1)

    fire('online')
    expect(statuses.at(-1)).toBe('connected')
    expect(opened).toHaveLength(1)
    expect(state.resyncs).toBe(2)

    fire('offline')
    opened[0]?.emit(1006)
    fire('online')
    expect(opened).toHaveLength(2)
    expect(statuses.at(-1)).toBe('reconnecting')
    opened[1]?.open()
    expect(statuses.at(-1)).toBe('connected')
  })

})

describe('live session messages', () => {
  it('reloads on a refresh notification and not on the hello frame', () => {
    const { session, opened, state } = harness()
    session.start()
    opened[0]?.open()
    opened[0]?.message('{"type":"device.status","payload":{"proto":1}}')
    expect(state.resyncs).toBe(0)
    opened[0]?.message('{"type":"timing_event.created","payload":{"id":"F1"}}')
    opened[0]?.message('{"type":"results.updated","payload":{}}')
    expect(state.resyncs).toBe(2)
    opened[0]?.message('nope')
    expect(state.resyncs).toBe(2)
  })

})

describe('live session resync', () => {
  it('does not resync the first open, only a later one', () => {
    const { session, opened, run, state } = harness()
    session.start()
    opened[0]?.open()
    expect(state.resyncs).toBe(0)
    opened[0]?.emit(1006)
    run(500)
    opened[1]?.open()
    expect(state.resyncs).toBe(1)
  })
})
