import { describe, expect, it } from 'vitest'
import { ambiguousKeys, catalogKeys, en, fi, formatDate, formatDateTime, formatTime, mismatchedKeys, missingKeys, parseLocale } from './index.js'

describe('i18n', () => {
  it('has the same keys in Finnish and English', () => {
    expect(missingKeys('en')).toEqual([])
    expect(missingKeys('fi')).toEqual([])
    expect(mismatchedKeys(fi, en)).toEqual([])
    expect(Object.keys(en).sort()).toEqual([...catalogKeys()].sort())
  })

  it('reports a key that exists in only one language', () => {
    expect(mismatchedKeys({ a: '1' }, { a: '1', b: '2' }, 'fi', 'en')).toEqual(['fi:b'])
    expect(mismatchedKeys({ a: '1', c: '3' }, { a: '1' }, 'fi', 'en')).toEqual(['en:c'])
  })

  it('rejects a key that is both a leaf and a prefix', () => {
    expect(ambiguousKeys({ 'finish.hint': 'old', 'finish.hint.keys': 'new' })).toEqual(['finish.hint'])
    expect(ambiguousKeys(fi)).toEqual([])
    expect(ambiguousKeys(en)).toEqual([])
  })

  it('accepts only fi and en and falls back to Finnish', () => {
    expect(parseLocale('fi')).toBe('fi')
    expect(parseLocale('en')).toBe('en')
    expect(parseLocale('fr')).toBe('fi')
    expect(parseLocale('EN')).toBe('fi')
    expect(parseLocale('')).toBe('fi')
    expect(parseLocale(null)).toBe('fi')
    expect(parseLocale(undefined)).toBe('fi')
    expect(parseLocale('<script>alert(1)</script>')).toBe('fi')
  })

  it('formats 15 October 2026 as a Finnish and British date', () => {
    expect(formatDate('2026-10-15', 'fi')).toBe('15.10.2026')
    expect(formatDate('2026-10-15', 'en')).toBe('15/10/2026')
    expect(formatDate(new Date(2026, 9, 15, 23, 30), 'fi')).toBe('15.10.2026')
    expect(formatDate('not-a-date', 'fi')).toBe('not-a-date')
  })

  it('formats time of day in fi-FI and en-GB', () => {
    const afternoon = new Date(2026, 9, 15, 14, 30)
    expect(formatTime(new Date(2026, 9, 15, 9, 5), 'fi')).toBe('09.05')
    expect(formatTime(new Date(2026, 9, 15, 9, 5), 'en')).toBe('09:05')
    expect(formatDateTime(afternoon, 'fi')).toBe('15.10.2026 klo 14.30')
    expect(formatDateTime(afternoon, 'en')).toBe('15/10/2026, 14:30')
  })
})
