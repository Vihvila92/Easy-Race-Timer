// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_TIMEOUT_MS } from './api.js'
import { readQueue, recordTap } from './queue.js'

const tap = {
  id: 'device:tap-1',
  deviceId: 'device',
  timeMs: 1_700_000_000_000,
  bib: 105,
  mode: 'time_first',
  label: 'F001',
}

type Row = { id: string } & Record<string, unknown>

/** Just enough IndexedDB for the finish queue: one store, put, and getAll. */
function installQueueDb(): void {
  const databases = new Map<string, { version: number; stores: Map<string, Map<string, Row>> }>()

  class FakeRequest<T> {
    result!: T
    error: unknown = null
    onsuccess: (() => void) | null = null
    onerror: (() => void) | null = null
    onupgradeneeded: (() => void) | null = null
    onblocked: (() => void) | null = null
  }

  function database(name: string) {
    const record = databases.get(name) ?? { version: 0, stores: new Map<string, Map<string, Row>>() }
    databases.set(name, record)
    return {
      objectStoreNames: {
        contains: (store: string) => record.stores.has(store),
      },
      createObjectStore: (store: string) => {
        record.stores.set(store, new Map())
      },
      transaction: (store: string) => {
        const rows = record.stores.get(store) ?? new Map<string, Row>()
        record.stores.set(store, rows)
        return {
          objectStore: () => ({
            put: (item: Row) => {
              const request = new FakeRequest<undefined>()
              queueMicrotask(() => {
                rows.set(item.id, structuredClone(item))
                request.onsuccess?.()
              })
              return request
            },
            getAll: () => {
              const request = new FakeRequest<Row[]>()
              queueMicrotask(() => {
                request.result = [...rows.values()].map((row) => structuredClone(row))
                request.onsuccess?.()
              })
              return request
            },
          }),
        }
      },
      close: () => undefined,
      record,
    }
  }

  vi.stubGlobal('indexedDB', {
    open: (name: string, version = 1) => {
      const db = database(name)
      const request = new FakeRequest<ReturnType<typeof database>>()
      request.result = db
      queueMicrotask(() => {
        if (db.record.version < version) {
          request.onupgradeneeded?.()
          db.record.version = version
        }
        request.onsuccess?.()
      })
      return request
    },
    deleteDatabase: (name: string) => {
      const request = new FakeRequest<undefined>()
      queueMicrotask(() => {
        databases.delete(name)
        request.onsuccess?.()
      })
      return request
    },
  })
}

describe('queued finish upload', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps the tap queued and does not abort the upload when startup calls would time out', async () => {
    vi.useFakeTimers()
    installQueueDb()
    let signal: AbortSignal | undefined
    const started = new Promise<void>((resolve) => {
      vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
        signal = init?.signal ?? undefined
        resolve()
        return new Promise(() => undefined)
      })
    })
    const pending = recordTap(tap)
    pending.catch(() => undefined)
    await started
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS + 5_000)
    expect(signal).toBeUndefined()
    const rows = await readQueue()
    expect(rows).toEqual([expect.objectContaining({ id: tap.id, synced: false, timeMs: tap.timeMs, bib: 105 })])
    const status = await Promise.race([
      pending.then(() => 'settled'),
      Promise.resolve('still-uploading'),
    ])
    expect(status).toBe('still-uploading')
  })

  it('keeps the tap queued when the upload fails', async () => {
    installQueueDb()
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('network down')))
    const result = await recordTap({ ...tap, id: 'device:tap-2' })
    expect(result.synced).toBe(false)
    const rows = await readQueue()
    expect(rows).toEqual([expect.objectContaining({ id: 'device:tap-2', synced: false, bib: 105 })])
  })
})
