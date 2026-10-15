import { describe, expect, it } from 'vitest'
import { defaultPublication } from './privacy.js'

describe('default publication', () => {
  it('uses initials when age is unknown or under 15', () => {
    const reference = '2027-06-12'
    expect(defaultPublication({ gender: 'M', birthDate: null, birthYear: null }, reference)).toBe('initials')
    expect(defaultPublication({ gender: 'F', birthDate: '2016-01-01', birthYear: 2016 }, reference)).toBe('initials')
    expect(defaultPublication({ gender: 'M', birthDate: '1990-01-01', birthYear: 1990 }, reference)).toBe('full')
  })
})
