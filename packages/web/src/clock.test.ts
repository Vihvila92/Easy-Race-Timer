import { describe, expect, it } from 'vitest'
import { estimateOffsetMs } from './api.js'

describe('server clock offset', () => {
  it('subtracts a device clock that is 90 seconds ahead', () => {
    const server = 1_700_000_000_000
    const t0 = server + 90_000
    const t1 = t0 + 40
    expect(estimateOffsetMs(server, t0, t1)).toBe(-90_020)
    expect(t1 + estimateOffsetMs(server, t0, t1)).toBe(server + 20)
  })
})
