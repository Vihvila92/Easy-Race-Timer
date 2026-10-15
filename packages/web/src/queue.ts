import { api } from './api.js'

export interface QueuedTap {
  id: string
  timeMs: number
  bib: number | null
  mode: string
  synced: boolean
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
  return rows.filter((row) => !row.synced).length
}

export async function recordTap(item: Omit<QueuedTap, 'synced'>): Promise<string[]> {
  await put({ ...item, synced: false })
  return flush(item.id)
}

export async function flush(focusId?: string): Promise<string[]> {
  const db = await openDb()
  const rows = await requestToPromise(db.transaction(STORE).objectStore(STORE).getAll()) as QueuedTap[]
  db.close()
  let flags: string[] = []
  for (const item of rows) {
    if (item.synced) continue
    const saved = await api<{ flags?: string[] }>('/api/v1/timing-events', {
      method: 'POST',
      body: JSON.stringify({ id: item.id, timeMs: item.timeMs, bib: item.bib, mode: item.mode }),
    })
    if (item.id === focusId) flags = saved.flags ?? []
    await put({ ...item, synced: true })
  }
  return flags
}
