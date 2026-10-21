import { describe, expect, it } from 'vitest'
import { ambiguousKeys, catalogKeys, commitEditableDate, en, fi, formatDate, formatDateTime, formatEditableDate, formatTime, mismatchedKeys, missingKeys, parseEditableDate, parseLocale } from './index.js'

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

  it('keeps zero-padding in formatDate', () => {
    expect(formatDate('2027-06-12', 'fi')).toBe('12.06.2027')
    expect(formatDate('2027-06-12', 'en')).toBe('12/06/2027')
    expect(formatDate('2026-06-05', 'fi')).toBe('05.06.2026')
  })

  it('formats an editable date in the app locale', () => {
    expect(formatEditableDate('2027-06-12', 'fi')).toBe('12.6.2027')
    expect(formatEditableDate('2026-06-05', 'fi')).toBe('5.6.2026')
    expect(formatEditableDate('2026-10-15', 'fi')).toBe('15.10.2026')
    expect(formatEditableDate('2027-06-12', 'en')).toBe('12/06/2027')
    expect(formatEditableDate('2026-10-15', 'en')).toBe('15/10/2026')
    expect(formatEditableDate('not-a-date', 'fi')).toBe('not-a-date')
  })

  it('parses an editable date back to ISO without using the browser order', () => {
    expect(parseEditableDate('12.6.2027', 'fi')).toBe('2027-06-12')
    expect(parseEditableDate('12.06.2027', 'fi')).toBe('2027-06-12')
    expect(parseEditableDate('5.6.2026', 'fi')).toBe('2026-06-05')
    expect(parseEditableDate('2027-06-12', 'fi')).toBe('2027-06-12')
    expect(parseEditableDate('2027-06-12', 'en')).toBe('2027-06-12')
    expect(parseEditableDate('12/6/2027', 'en')).toBe('2027-06-12')
    expect(parseEditableDate('06/12/2027', 'en')).toBe('2027-12-06')
    expect(parseEditableDate('06/12/2027', 'fi')).toBeNull()
    expect(parseEditableDate('12.6.2027', 'en')).toBeNull()
    expect(parseEditableDate('31.2.2027', 'fi')).toBeNull()
    expect(parseEditableDate('29.2.2027', 'fi')).toBeNull()
    expect(parseEditableDate('29.2.2028', 'fi')).toBe('2028-02-29')
    expect(commitEditableDate('2027-06-12', 'fi')).toEqual({ text: '12.6.2027', iso: '2027-06-12' })
    expect(commitEditableDate('31.2.2027', 'fi')).toEqual({ text: '31.2.2027', iso: '' })
    expect(commitEditableDate(' 12/06/2027 ', 'en')).toEqual({ text: '12/06/2027', iso: '2027-06-12' })
  })

  it('formats time of day in fi-FI and en-GB', () => {
    const afternoon = new Date(2026, 9, 15, 14, 30)
    expect(formatTime(new Date(2026, 9, 15, 9, 5), 'fi')).toBe('09.05')
    expect(formatTime(new Date(2026, 9, 15, 9, 5), 'en')).toBe('09:05')
    expect(formatDateTime(afternoon, 'fi')).toBe('15.10.2026 klo 14.30')
    expect(formatDateTime(afternoon, 'en')).toBe('15/10/2026, 14:30')
  })
})
