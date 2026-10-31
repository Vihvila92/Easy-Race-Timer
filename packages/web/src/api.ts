// SPDX-License-Identifier: AGPL-3.0-only
import { createId } from '@ert/core'
import type { Workspace } from './types.js'

export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly details?: unknown) {
    super(message)
  }
}

/** A startup call that stays open this long is treated as unreachable. */
export const API_TIMEOUT_MS = 10_000

export type ApiInit = RequestInit & {
  /** False keeps the request alive. Queued finish uploads set this so a slow POST is not cancelled. */
  timeout?: false
}

/** Same-origin path. The desktop shell chooses the port; this client must not embed a host. */
export async function api<T>(path: string, init?: ApiInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase()
  const { timeout, signal: outer, ...rest } = init ?? {}
  const timed = timeout !== false
  const controller = new AbortController()
  const onOuterAbort = () => controller.abort(outer?.reason)
  if (outer) {
    if (outer.aborted) controller.abort(outer.reason)
    else outer.addEventListener('abort', onOuterAbort, { once: true })
  }
  const timer = timed ? setTimeout(() => controller.abort(), API_TIMEOUT_MS) : undefined
  let response: Response
  try {
    response = await fetch(path, {
      ...rest,
      credentials: 'same-origin',
      headers: {
        ...(method !== 'GET' && method !== 'HEAD' ? { 'content-type': 'application/json' } : {}),
        ...(rest.headers ?? {}),
      },
      signal: timed || outer ? controller.signal : undefined,
    })
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    outer?.removeEventListener('abort', onOuterAbort)
  }
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

const CLOCK_OFFSET_KEY = 'ert-clock-offset'

export interface StoredClockOffset {
  offsetMs: number
  rttMs: number
  measuredAt: number
}

function testClockMs(): number | null {
  const stored = sessionStorage.getItem('ert-test-clock')
  if (!stored) return null
  const parsed = Date.parse(stored)
  return Number.isNaN(parsed) ? null : parsed
}

export function readClockOffset(): StoredClockOffset | null {
  try {
    const raw = localStorage.getItem(CLOCK_OFFSET_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredClockOffset>
    if (typeof parsed.offsetMs !== 'number' || !Number.isFinite(parsed.offsetMs)) return null
    return {
      offsetMs: parsed.offsetMs,
      rttMs: typeof parsed.rttMs === 'number' ? parsed.rttMs : Number.POSITIVE_INFINITY,
      measuredAt: typeof parsed.measuredAt === 'number' ? parsed.measuredAt : 0,
    }
  } catch {
    return null
  }
}

/** server_time − (t0 + t1) / 2. A fast clock produces a negative offset. */
export function estimateOffsetMs(serverMs: number, t0: number, t1: number): number {
  return Math.round(serverMs - (t0 + t1) / 2)
}

/**
 * Sample the server clock and keep the smallest round trip.
 * The simulated test clock is already the server time, so it is left alone.
 */
export async function syncServerClock(samples = 3): Promise<StoredClockOffset | null> {
  if (testClockMs() != null) return null
  let best: StoredClockOffset | null = null
  for (let i = 0; i < samples; i += 1) {
    const t0 = Date.now()
    let serverMs: number
    try {
      const body = await api<{ time_ms: number }>('/api/v1/time')
      serverMs = body.time_ms
    } catch {
      continue
    }
    const t1 = Date.now()
    const sample: StoredClockOffset = {
      offsetMs: estimateOffsetMs(serverMs, t0, t1),
      rttMs: t1 - t0,
      measuredAt: t1,
    }
    if (!best || sample.rttMs < best.rttMs) best = sample
  }
  if (!best) return readClockOffset()
  localStorage.setItem(CLOCK_OFFSET_KEY, JSON.stringify(best))
  return best
}

export async function clockMs(): Promise<number> {
  const simulated = testClockMs()
  if (simulated != null) return simulated
  const body = await api<{ time_ms: number }>('/api/v1/time')
  return body.time_ms
}

/** Device clock, or the simulated test clock. Never waits on the network. */
export function deviceNow(): number {
  return testClockMs() ?? Date.now()
}

/** Tap instant. Test clock as-is; otherwise the device clock plus the stored server offset. */
export function clientNow(): number {
  const simulated = testClockMs()
  if (simulated != null) return simulated
  return Date.now() + (readClockOffset()?.offsetMs ?? 0)
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
