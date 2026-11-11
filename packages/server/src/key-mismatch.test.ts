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
    expect(translate('fi', 'file.keyMismatch')).toBe('Avaintiedosto ei kuulu tähän kisatiedostoon tai kisatiedosto on vaurioitunut. Käytä kisatiedoston kanssa samaan aikaan tallennettua avaintiedostoa tai palauta varmuuskopio.')
    expect(BELONGS).toBe('This key file does not belong to this race file, or the race file is damaged. Use the key file that was saved together with the race file, or restore a backup.')
  })
})
