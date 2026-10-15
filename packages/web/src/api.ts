import { createId } from '@ert/core'
import type { Workspace } from './types.js'

export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly details?: unknown) {
    super(message)
  }
}

/** Same-origin path. The desktop shell chooses the port; this client must not embed a host. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase()
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(method !== 'GET' && method !== 'HEAD' ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string; details?: unknown } }
    throw new ApiError(body.error?.code ?? 'VALIDATION_ERROR', body.error?.message ?? response.statusText, body.error?.details)
  }
  const type = response.headers.get('content-type') ?? ''
  if (type.includes('text/html') || type.includes('text/csv')) return await response.text() as T
  const text = await response.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

export function loadWorkspace(): Promise<Workspace> {
  return api<Workspace>('/api/v1/bootstrap')
}

export async function clockMs(): Promise<number> {
  const stored = sessionStorage.getItem('ert-test-clock')
  if (stored) {
    const parsed = Date.parse(stored)
    if (!Number.isNaN(parsed)) return parsed
  }
  const body = await api<{ time_ms: number }>('/api/v1/time')
  return body.time_ms
}

/** Tap instant. Uses the test clock when set, otherwise the device clock. Never waits on the network. */
export function clientNow(): number {
  const stored = sessionStorage.getItem('ert-test-clock')
  if (stored) {
    const parsed = Date.parse(stored)
    if (!Number.isNaN(parsed)) return parsed
  }
  return Date.now()
}

export function localDeviceId(): string {
  const existing = localStorage.getItem('ert-device-id')
  if (existing) return existing
  const created = createId()
  localStorage.setItem('ert-device-id', created)
  return created
}

/** Globally unique finish id: this browser's device id plus a ULID. */
export function createTapId(): string {
  return `${localDeviceId()}:${createId()}`
}

/** Display number only. The stored id is createTapId(). */
export function nextTapLabel(): string {
  const next = Number(sessionStorage.getItem('ert-next-tap') ?? '1')
  sessionStorage.setItem('ert-next-tap', String(next + 1))
  return `F${String(next).padStart(3, '0')}`
}
