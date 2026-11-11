// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { en, fi, translate } from '@ert/i18n'
import { ApiError } from './api.js'
import { openFileFailure } from './key-client.js'
import { RACE_FILE_CODES, RaceFileError, keyMessageKey, raceFileErrorFromCode } from './key-errors.js'

const API = {
  corrupt: 'RACE_FILE_CORRUPT',
  'key-mismatch': 'KEY_FILE_MISMATCH',
  'recovery-unacknowledged': 'RECOVERY_UNACKNOWLEDGED',
  newer: 'RACE_FILE_NEWER',
} as const

describe('RaceFileError', () => {
  it('maps every code to its own sentence', () => {
    for (const code of RACE_FILE_CODES) {
      const error = raceFileErrorFromCode(API[code])
      expect(error).toBeInstanceOf(RaceFileError)
      expect(error?.code).toBe(code)
      expect(error?.i18nKey).toBe(new RaceFileError(code).i18nKey)
      expect(translate('en', error!.i18nKey)).toBe(en[error!.i18nKey])
      expect(translate('fi', error!.i18nKey)).toBe(fi[error!.i18nKey])
    }
  })

  it('uses the key-mismatch text for a mismatched key file and a backup sentence for a corrupt file', () => {
    const mismatch = raceFileErrorFromCode('KEY_FILE_MISMATCH')
    const corrupt = raceFileErrorFromCode('RACE_FILE_CORRUPT')
    const pending = raceFileErrorFromCode('RECOVERY_UNACKNOWLEDGED')
    expect(mismatch?.i18nKey).toBe('file.keyMismatch')
    expect(keyMessageKey('KEY_FILE_MISMATCH')).toBe('file.keyMismatch')
    expect(en['file.keyMismatch']).toContain('does not belong')
    expect(corrupt?.i18nKey).toBe('file.corrupt')
    expect(en['file.corrupt']).toContain('Restore a backup')
    expect(en['file.corrupt']).not.toBe(en['file.keyMismatch'])
    expect(fi['file.keyMismatch']).not.toContain(', tai')
    expect(pending?.i18nKey).toBe('keys.acknowledgeFirst')
    expect(en['keys.acknowledgeFirst']).toBe('First confirm that you have printed or written down the new recovery key.')
    expect(fi['keys.acknowledgeFirst']).toBe('Vahvista ensin, että olet tulostanut tai kirjoittanut ylös uuden palautusavaimen.')
    const wrong = openFileFailure(new ApiError('UNLOCK_FAILED', 'no'), 'keys.passwordWrong')
    const stale = openFileFailure(new ApiError('UNLOCK_FAILED', 'no'), 'keys.ackStale')
    const unacked = openFileFailure(new ApiError('RECOVERY_UNACKNOWLEDGED', 'no'), 'keys.passwordWrong')
    expect(wrong.key).toBe('keys.passwordWrong')
    expect(stale.key).toBe('keys.ackStale')
    expect(unacked.key).toBe('keys.recoveryUnshown')
    expect(en['keys.passwordWrong']).toBe('The current password is wrong.')
    expect(fi['keys.passwordWrong']).toBe('Nykyinen salasana on väärä.')
  })
})
