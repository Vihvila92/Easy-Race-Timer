// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { formatDuration, formatOffsetNote } from './time.js'

describe('duration clock', () => {
  it('floors to a clock and keeps an ascii minus on a negative duration', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(65_000)).toBe('1:05')
    expect(formatDuration(-65_000)).toBe('-1:05')
    expect(formatDuration(3_661_000)).toBe('1:01:01')
  })

  it('uses a unicode minus in the offset note', () => {
    expect(formatOffsetNote(0)).toBe('Siirretty lähtö +0:00')
    expect(formatOffsetNote(65_000)).toBe('Siirretty lähtö +1:05')
    expect(formatOffsetNote(-65_000)).toBe('Siirretty lähtö −1:05')
  })
})
