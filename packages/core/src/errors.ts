// SPDX-License-Identifier: AGPL-3.0-only
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'ENTRY_EXISTS',
  'BIB_IN_USE',
  'RACE_NOT_STARTED',
  'EVENT_LOCKED',
  'LOCK_BLOCKED',
  'PIN_REQUIRED',
  'NO_MATCHING_CATEGORY',
  'TIE_UNCONFIRMED',
  'CLUB_ABBREVIATION_TAKEN',
  'CLUB_ABBREVIATION_CONFLICT',
  'SYNC_CONFLICT',
  'BACKUP_FAILED',
  'UNLOCK_FAILED',
  'RECOVERY_KEY_CHECKSUM',
  'KEY_PARAMS_REJECTED',
  'FILE_HEADER_INVALID',
  'PASSWORD_TOO_SHORT',
  'PASSWORD_TOO_LONG',
  'PASSWORD_COMMON',
  'PASSWORD_MISMATCH',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 422,
  NOT_FOUND: 404,
  ENTRY_EXISTS: 409,
  BIB_IN_USE: 409,
  RACE_NOT_STARTED: 409,
  EVENT_LOCKED: 423,
  LOCK_BLOCKED: 409,
  PIN_REQUIRED: 401,
  NO_MATCHING_CATEGORY: 422,
  TIE_UNCONFIRMED: 409,
  CLUB_ABBREVIATION_TAKEN: 409,
  CLUB_ABBREVIATION_CONFLICT: 409,
  SYNC_CONFLICT: 409,
  BACKUP_FAILED: 500,
  UNLOCK_FAILED: 401,
  RECOVERY_KEY_CHECKSUM: 400,
  KEY_PARAMS_REJECTED: 400,
  FILE_HEADER_INVALID: 400,
  PASSWORD_TOO_SHORT: 422,
  PASSWORD_TOO_LONG: 422,
  PASSWORD_COMMON: 422,
  PASSWORD_MISMATCH: 422,
}

export class AppError extends Error {
  readonly status: number
  readonly details?: unknown

  constructor(readonly code: ErrorCode, message: string, details?: unknown) {
    super(message)
    this.status = STATUS[code]
    this.details = details
  }
}

export function errorBody(error: AppError): { error: { code: string; message: string; details?: unknown } } {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details !== undefined ? { details: error.details } : {}),
    },
  }
}
