// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { defaultPublication, publishedName } from './privacy.js'

describe('default publication', () => {
  it('uses initials when age is unknown or under 15', () => {
    const reference = '2027-06-12'
    expect(defaultPublication({ gender: 'M', birthDate: null, birthYear: null }, reference)).toBe('initials')
    expect(defaultPublication({ gender: 'F', birthDate: '2016-01-01', birthYear: 2016 }, reference)).toBe('initials')
    expect(defaultPublication({ gender: 'M', birthDate: '1990-01-01', birthYear: 1990 }, reference)).toBe('full')
  })
})

describe('published name', () => {
  it('prints initials as given name then surname, without the surname', () => {
    const name = publishedName('Hämäläinen Lotta', 'initials')
    expect(name).toBe('L. H.')
    expect(name).not.toContain('Hämäläinen')
    expect(publishedName('Lapsi Liisa Maria', 'initials')).toBe('L. M. L.')
    expect(publishedName('Aikuinen', 'initials')).toBe('A.')
    expect(publishedName('Hämäläinen Lotta', 'full')).toBe('Hämäläinen Lotta')
    expect(publishedName('Hämäläinen Lotta', 'hidden')).toBe('')
  })
})
