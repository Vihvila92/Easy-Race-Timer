// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import {
  dateFieldInvalid,
  dateFieldOnBlur,
  dateFieldOnInput,
  dateFieldOnValue,
  dateFieldShown,
  initialDateDraft,
} from './date-field.js'

describe('date field state', () => {
  it('shows the stored date until the volunteer types', () => {
    const draft = initialDateDraft('2027-06-12')
    expect(dateFieldShown('2027-06-12', 'fi', draft)).toBe('12.6.2027')
    expect(dateFieldShown('2027-06-12', 'en', draft)).toBe('12/06/2027')
    expect(dateFieldInvalid('12.6.2027', 'fi', draft)).toBe(false)
  })

  it('keeps an invalid draft and reports it only after blur', () => {
    const started = initialDateDraft('2027-06-12')
    const typing = dateFieldOnInput(started, '31.2.2027', 'fi')
    expect(typing.iso).toBe('')
    expect(dateFieldShown('', 'fi', typing.draft)).toBe('31.2.2027')
    expect(dateFieldInvalid('31.2.2027', 'fi', typing.draft)).toBe(false)
    const left = dateFieldOnBlur(typing.draft)
    expect(dateFieldInvalid('31.2.2027', 'fi', left)).toBe(true)
    expect(dateFieldInvalid('', 'fi', dateFieldOnBlur(dateFieldOnInput(started, '', 'fi').draft))).toBe(true)
  })

  it('clears the error when the text becomes a date', () => {
    const invalid = dateFieldOnBlur(dateFieldOnInput(initialDateDraft('2027-06-12'), '31.2.2027', 'fi').draft)
    const fixed = dateFieldOnInput(invalid, '12.6.2027', 'fi')
    expect(fixed.iso).toBe('2027-06-12')
    expect(dateFieldShown('2027-06-12', 'fi', fixed.draft)).toBe('12.6.2027')
    expect(dateFieldInvalid('12.6.2027', 'fi', dateFieldOnBlur(fixed.draft))).toBe(false)
  })

  it('follows an external value while idle and keeps a draft while focused', () => {
    const idle = initialDateDraft('2027-06-12')
    const reset = dateFieldOnValue(idle, '2026-10-15')
    expect(dateFieldShown('2026-10-15', 'fi', reset)).toBe('15.10.2026')

    const typing = dateFieldOnInput(idle, '31.2.2027', 'fi').draft
    const duringEdit = dateFieldOnValue(typing, '2026-10-15')
    expect(dateFieldShown('2026-10-15', 'fi', duringEdit)).toBe('31.2.2027')

    const after = dateFieldOnValue(dateFieldOnBlur(typing), '2026-10-15')
    expect(dateFieldShown('2026-10-15', 'fi', after)).toBe('15.10.2026')
  })
})
