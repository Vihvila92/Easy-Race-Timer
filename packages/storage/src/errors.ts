// SPDX-License-Identifier: AGPL-3.0-only
export type RaceFileKind = 'open' | 'newer' | 'dev-key' | 'missing-key' | 'key-file'

export type KeyErrorCode =
  | 'UNLOCK_FAILED'
  | 'RECOVERY_KEY_CHECKSUM'
  | 'KEY_PARAMS_REJECTED'
  | 'FILE_HEADER_INVALID'
  | 'PASSWORD_TOO_SHORT'
  | 'PASSWORD_TOO_LONG'
  | 'PASSWORD_COMMON'
  | 'PASSWORD_MISMATCH'

const KEY_MESSAGES: Record<KeyErrorCode, string> = {
  UNLOCK_FAILED: 'That did not open the file.',
  RECOVERY_KEY_CHECKSUM: 'This recovery key has a typing error.',
  KEY_PARAMS_REJECTED: "This file's key settings are not allowed, so it was not opened.",
  FILE_HEADER_INVALID: 'This file cannot be opened.',
  PASSWORD_TOO_SHORT: 'Password is too short.',
  PASSWORD_TOO_LONG: 'Password is too long.',
  PASSWORD_COMMON: 'Password is too common.',
  PASSWORD_MISMATCH: 'Passwords do not match.',
}

/**
 * One message for a race file the app will not open.
 * The text has the file name only: no directory, no key material, no stack.
 */
export class RaceFileError extends Error {
  readonly fileName: string
  readonly kind: RaceFileKind

  constructor(fileName: string, kind: RaceFileKind) {
    const message = kind === 'newer'
      ? 'This race file was saved by a newer Easy Race Timer.'
      : kind === 'dev-key'
        ? 'Dev key provider is disabled in production.'
        : kind === 'missing-key'
          ? 'No data key is configured. Refusing to open the race file.'
          : kind === 'key-file'
            ? 'The key file does not match this race file.'
            : `Could not open race file ${fileName}.`
    super(message)
    this.name = 'RaceFileError'
    this.fileName = fileName
    this.kind = kind
    this.stack = message
  }
}

/** Unlock and password failures. The message is fixed and names no slot and no secret. */
export class KeyError extends Error {
  readonly retryAfterMs?: number

  constructor(readonly code: KeyErrorCode, retryAfterMs?: number) {
    super(KEY_MESSAGES[code])
    this.name = 'KeyError'
    this.retryAfterMs = retryAfterMs
    this.stack = KEY_MESSAGES[code]
  }

  toJSON(): { error: { code: KeyErrorCode; message: string; retryAfterMs?: number } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.retryAfterMs !== undefined ? { retryAfterMs: this.retryAfterMs } : {}),
      },
    }
  }
}
