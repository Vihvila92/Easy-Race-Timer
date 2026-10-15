import { describe, expect, it } from 'vitest'
import { consentAge, guardianRequired, validateConsentActor } from './consent.js'

const raceDay = '2027-06-12'

describe('consent age', () => {
  it('requires a guardian under 15 and when age is unknown', () => {
    expect(consentAge({ gender: 'M', birthDate: '2012-06-13', birthYear: 2012 }, raceDay)).toBe(14)
    expect(consentAge({ gender: 'M', birthDate: '2012-06-12', birthYear: 2012 }, raceDay)).toBe(15)
    expect(consentAge({ gender: 'M', birthDate: null, birthYear: null }, raceDay)).toBeNull()
    expect(guardianRequired(14)).toBe(true)
    expect(guardianRequired(null)).toBe(true)
    expect(guardianRequired(15)).toBe(false)
  })

  it('stores guardian details and refuses self-consent under 15', () => {
    expect(() => validateConsentActor({ givenBy: 'self', age: 14 })).toThrow(/under 15/)
    expect(() => validateConsentActor({ givenBy: 'self', age: null })).toThrow(/under 15/)
    expect(() => validateConsentActor({
      givenBy: 'guardian',
      age: 10,
      guardian: { name: 'Ada', relation: '', contact: 'ada@example.com' },
    })).toThrow(/relation/)
    expect(validateConsentActor({ givenBy: 'self', age: 15 })).toEqual({ name: null, evidence: null })
    expect(validateConsentActor({
      givenBy: 'guardian',
      age: 10,
      guardian: { name: 'Ada Parent', relation: 'parent', contact: 'ada@example.com' },
    })).toEqual({
      name: 'Ada Parent',
      evidence: JSON.stringify({ relation: 'parent', contact: 'ada@example.com' }),
    })
  })
})
