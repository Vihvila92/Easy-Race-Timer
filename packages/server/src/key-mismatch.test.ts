// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { translate } from '@ert/i18n'
import { RaceFileError } from '@ert/storage'
import { formatRaceFileError } from './race-file.js'

describe('mismatched key file', () => {
  it('names the key file instead of the generic open failure', () => {
    const error = new RaceFileError('ert.sqlite', 'key-file')
    expect(formatRaceFileError(error, 'fi')).toBe(translate('fi', 'file.keyMismatch'))
    expect(formatRaceFileError(error, 'fi')).not.toBe('Tiedosto ei auennut.')
    expect(formatRaceFileError(error, 'en')).toBe(translate('en', 'file.keyMismatch'))
  })
})
