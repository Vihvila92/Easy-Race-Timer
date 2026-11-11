// SPDX-License-Identifier: AGPL-3.0-only
import type { MessageKey } from '@ert/i18n'

export const RACE_FILE_CODES = ['corrupt', 'key-mismatch', 'recovery-unacknowledged'] as const

export type RaceFileErrorCode = (typeof RACE_FILE_CODES)[number]

const RACE_FILE_I18N: Record<RaceFileErrorCode, MessageKey> = {
  corrupt: 'file.corrupt',
  'key-mismatch': 'file.keyMismatch',
  'recovery-unacknowledged': 'keys.acknowledgeFirst',
}

/** A user-facing open or key error. The view translates `i18nKey`; logs stay elsewhere. */
export class RaceFileError extends Error {
  readonly i18nKey: MessageKey

  constructor(readonly code: RaceFileErrorCode) {
    super(code)
    this.name = 'RaceFileError'
    this.i18nKey = RACE_FILE_I18N[code]
  }
}

const API_RACE_FILE: Record<string, RaceFileErrorCode> = {
  RACE_FILE_CORRUPT: 'corrupt',
  KEY_FILE_MISMATCH: 'key-mismatch',
  RECOVERY_UNACKNOWLEDGED: 'recovery-unacknowledged',
}

const OTHER_KEYS: Record<string, MessageKey> = {
  UNLOCK_FAILED: 'unlock.failed',
  RECOVERY_KEY_CHECKSUM: 'unlock.recoveryChecksum',
  KEY_PARAMS_REJECTED: 'unlock.paramsRejected',
  FILE_HEADER_INVALID: 'unlock.headerInvalid',
  PASSWORD_TOO_SHORT: 'unlock.passwordShort',
  PASSWORD_TOO_LONG: 'unlock.passwordLong',
  PASSWORD_COMMON: 'unlock.passwordCommon',
  PASSWORD_MISMATCH: 'unlock.passwordMismatch',
}

export function raceFileErrorFromCode(code: string): RaceFileError | undefined {
  const mapped = API_RACE_FILE[code]
  if (!mapped) return undefined
  return new RaceFileError(mapped)
}

/** Locale key for an API error code. Key mismatch uses `file.keyMismatch`, not a fixed sentence. */
export function keyMessageKey(code: string): MessageKey | undefined {
  return raceFileErrorFromCode(code)?.i18nKey ?? OTHER_KEYS[code]
}
