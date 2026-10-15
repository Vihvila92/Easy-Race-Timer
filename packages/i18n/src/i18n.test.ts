import { describe, expect, it } from 'vitest'
import { catalogKeys, en, missingKeys } from './index.js'

describe('i18n', () => {
  it('has an English string for every Finnish key', () => {
    expect(missingKeys('en')).toEqual([])
    expect(missingKeys('fi')).toEqual([])
    expect(Object.keys(en).sort()).toEqual([...catalogKeys()].sort())
  })
})
