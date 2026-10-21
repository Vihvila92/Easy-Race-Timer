// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { licenseUrl, resolveSourceRef, sourceCodeUrl } from './source-link.js'

const COMMIT = '0123456789abcdef0123456789abcdef01234567'

describe('source link', () => {
  it('points a commit at that commit and a tag at that tag', () => {
    expect(sourceCodeUrl(COMMIT)).toBe(`https://github.com/Vihvila92/Easy-Race-Timer/commit/${COMMIT}`)
    expect(sourceCodeUrl(COMMIT.toUpperCase())).toBe(`https://github.com/Vihvila92/Easy-Race-Timer/commit/${COMMIT}`)
    expect(sourceCodeUrl('v0.1.0')).toBe('https://github.com/Vihvila92/Easy-Race-Timer/tree/v0.1.0')
    expect(licenseUrl(COMMIT)).toBe(`https://github.com/Vihvila92/Easy-Race-Timer/blob/${COMMIT}/LICENSE`)
    expect(licenseUrl('v0.1.0')).toBe('https://github.com/Vihvila92/Easy-Race-Timer/blob/v0.1.0/LICENSE')
    expect(sourceCodeUrl(COMMIT)).not.toBe('https://github.com/Vihvila92/Easy-Race-Timer')
  })

  it('uses the exact tag, then the commit, and rejects anything else', () => {
    expect(resolveSourceRef({ envRef: 'v0.2.0', exactTag: 'v0.1.0', commit: COMMIT })).toBe('v0.2.0')
    expect(resolveSourceRef({ exactTag: 'v0.1.0', commit: COMMIT })).toBe('v0.1.0')
    expect(resolveSourceRef({ exactTag: '  ', commit: COMMIT })).toBe(COMMIT)
    expect(resolveSourceRef({ commit: COMMIT.toUpperCase() })).toBe(COMMIT)
    expect(() => resolveSourceRef({})).toThrow(/tag or commit/)
    expect(() => sourceCodeUrl('')).toThrow(/tag or commit/)
    expect(() => sourceCodeUrl('..')).toThrow(/tag or commit/)
    expect(() => sourceCodeUrl('https://example.test')).toThrow(/tag or commit/)
  })
})
