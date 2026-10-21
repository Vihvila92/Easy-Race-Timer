import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_TIMEOUT_MS, api } from './api.js'
import { validateWorkspaceResponse } from './workspace.js'

describe('api timeout', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('aborts a hung startup call after 10s so the load can show the error view', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
      })
    })
    const pending = api('/api/v1/bootstrap')
    const settled = pending.then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS - 1)
    expect(signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(signal?.aborted).toBe(true)
    const result = await settled
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error)
      expect(validateWorkspaceResponse(result.error)).toEqual({ ok: false, reason: 'unreachable' })
    }
  })

  it('returns a response that arrives before the timeout', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined
      return Promise.resolve(new Response(JSON.stringify({ ties: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
    })
    await expect(api('/api/v1/bootstrap')).resolves.toEqual({ ties: [] })
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS)
    expect(signal?.aborted).toBe(false)
  })

  it('does not abort a request that opts out, so a queued upload can finish', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined
      return new Promise(() => undefined)
    })
    const pending = api('/api/v1/timing-events', { method: 'POST', body: '{}', timeout: false })
    const status = Promise.race([
      pending.then(() => 'settled'),
      Promise.resolve('still-uploading'),
    ])
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS + 5_000)
    expect(signal).toBeUndefined()
    await expect(status).resolves.toBe('still-uploading')
  })
})
