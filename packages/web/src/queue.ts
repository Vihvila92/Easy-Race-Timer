// SPDX-License-Identifier: AGPL-3.0-only
import { ApiError, api } from './api.js'

export interface QueuedTap {
  id: string
  deviceId: string
  timeMs: number
  /** Raw device clock. timeMs is the value corrected by the stored server offset. */
  deviceTimeMs?: number
  bib: number | null
  mode: string
  label: string
  synced: boolean
  conflict?: boolean
}

const DB_NAME = 'ert-queue'
const STORE = 'taps'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function put(item: QueuedTap): Promise<void> {
  const db = await openDb()
  await requestToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).put(item))
  db.close()
}

export async function pendingCount(): Promise<number> {
  const db = await openDb()
  const rows = await requestToPromise(db.transaction(STORE).objectStore(STORE).getAll()) as QueuedTap[]
  db.close()
  return rows.filter((row) => !row.synced && !row.conflict).length
}

export async function readQueue(): Promise<QueuedTap[]> {
  const db = await openDb()
  const rows = await requestToPromise(db.transaction(STORE).objectStore(STORE).getAll()) as QueuedTap[]
  db.close()
  return rows
}

/** Persist first, then try to sync. A network failure leaves the tap queued. */
export async function recordTap(item: Omit<QueuedTap, 'synced' | 'conflict'>): Promise<{ flags: string[]; synced: boolean }> {
  await put({ ...item, synced: false })
  return flush(item.id)
}

export async function flush(focusId?: string): Promise<{ flags: string[]; synced: boolean }> {
  const db = await openDb()
  const rows = await requestToPromise(db.transaction(STORE).objectStore(STORE).getAll()) as QueuedTap[]
  db.close()
  let flags: string[] = []
  let focusSynced = focusId == null
  for (const item of rows) {
    if (item.synced || item.conflict) continue
    try {
      const saved = await api<{ flags?: string[] }>('/api/v1/timing-events', {
        method: 'POST',
        timeout: false,
        body: JSON.stringify({
          id: item.id,
          deviceId: item.deviceId,
          timeMs: item.timeMs,
          deviceTimeMs: item.deviceTimeMs,
          bib: item.bib,
          mode: item.mode,
          label: item.label,
        }),
      })
      if (item.id === focusId) flags = saved.flags ?? []
      await put({ ...item, synced: true })
      if (item.id === focusId) focusSynced = true
    } catch (error) {
      if (error instanceof ApiError && error.code === 'SYNC_CONFLICT') {
        await put({ ...item, conflict: true })
        continue
      }
      if (item.id === focusId) focusSynced = false
      break
    }
  }
  return { flags, synced: focusSynced }
}
