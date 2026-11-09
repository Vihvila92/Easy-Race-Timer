// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { formatRaceFileError } from './race-file.js'

describe('open failure log', () => {
  it('keeps a path out of a raw error', () => {
    const pathError = Object.assign(new Error('EACCES: /home/runner/ert.sqlite'), { code: 'EACCES' })
    expect(formatRaceFileError(pathError)).toBe('EACCES')
    const prose = formatRaceFileError(new Error('could not open /home/runner/ert.sqlite'), 'en')
    expect(prose).toBe('The race file could not be opened.')
    expect(prose).not.toContain('/home/')
    const finnish = formatRaceFileError(new Error('could not open /home/runner/ert.sqlite'))
    expect(finnish).toBe('Kisatiedostoa ei voitu avata.')
    expect(finnish).not.toContain('race file')
    expect(finnish).not.toContain('/')
  })
})
