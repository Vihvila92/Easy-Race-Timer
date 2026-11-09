// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { translate } from '@ert/i18n'
import { RaceFileError } from '@ert/storage'
import { formatRaceFileError } from './race-file.js'

const BELONGS = translate('en', 'file.keyMismatch')

describe('mismatched key file', () => {
  it('does not use the post-unlock sentence in the process log', () => {
    const error = new RaceFileError('ert.sqlite', 'key-file')
    const logged = formatRaceFileError(error, 'fi')
    expect(logged).not.toBe(translate('fi', 'file.keyMismatch'))
    expect(logged).not.toContain('ert.sqlite')
    expect(logged).not.toBe(BELONGS)
    expect(translate('fi', 'file.keyMismatch')).toBe('Avaintiedosto ei kuulu tähän kisatiedostoon. Käytä kisatiedoston kanssa samaan aikaan tallennettua avaintiedostoa.')
    expect(BELONGS).toBe('This key file does not belong to this race file. Use the key file that was saved together with the race file.')
  })
})
