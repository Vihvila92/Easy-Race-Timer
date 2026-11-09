// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { translate } from '@ert/i18n'
import { formatRaceFileError } from './race-file.js'

describe('open failure log', () => {
  it('keeps a path out of a raw error', () => {
    const pathError = Object.assign(new Error('EACCES: /home/runner/ert.sqlite'), { code: 'EACCES' })
    expect(formatRaceFileError(pathError)).toBe('EACCES')
    const prose = formatRaceFileError(new Error('could not open /home/runner/ert.sqlite'), 'en')
    expect(prose).toBe(translate('en', 'file.openFailed', { name: 'race file' }))
    expect(prose).not.toContain('/home/')
  })
})
