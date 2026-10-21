import { describe, expect, it } from 'vitest'
import { blockerLink } from './blockers.js'

describe('lock blocker labels', () => {
  it('translates the known ids and keeps the raw id when it does not match', () => {
    expect(blockerLink('entry:108:no_result', 'fi')).toEqual({
      href: '#/entries',
      text: 'Numerolla 108 ei ole tulosta',
    })
    expect(blockerLink('entry:108:no_result', 'en').text).toBe('Bib 108 has no result')
    expect(blockerLink('time:F063:unassigned', 'fi').text).toBe('Ajalla F063 ei ole numeroa')
    expect(blockerLink('time:F063:before_start', 'en').text).toBe('Time F063 is before the start')
    expect(blockerLink('tie:R4:21:32', 'fi')).toEqual({
      href: '#/ties',
      text: 'Ratkaisematon tasatilanne, R4, 21:32',
    })
    expect(blockerLink('tie:R8:41:07', 'en')).toEqual({
      href: '#/ties',
      text: 'Unconfirmed tie, R8, 41:07',
    })
    expect(blockerLink('entry:108:no_result', 'fi').text).not.toContain('entry:')
    expect(blockerLink('mystery', 'fi')).toEqual({ href: '#/entries', text: 'mystery' })
  })
})
