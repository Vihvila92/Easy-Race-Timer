// SPDX-License-Identifier: AGPL-3.0-only
import { translate, type Locale } from '@ert/i18n'
import { RaceFileError } from '@ert/storage'

/**
 * One line for the process log when a race file will not open.
 * A newer file includes the guided hint. A bad key and a damaged file share one message.
 */
export function formatRaceFileError(error: unknown, locale: Locale = 'fi'): string {
  if (error instanceof RaceFileError) {
    if (error.kind === 'newer') return `${translate(locale, 'file.newer')} ${translate(locale, 'file.hint.newer')}`
    if (error.kind === 'dev-key' || error.kind === 'key-file') return error.message
    if (error.kind === 'missing-key') return translate(locale, 'file.missingKey')
    if (error.kind === 'open') {
      return `${openFailed(locale, error.fileName)} ${translate(locale, 'file.hint.openFailed')}`
    }
    return openFailed(locale, error.fileName)
  }
  if (error instanceof Error) return loggedOpenFailure(error, locale)
  return openFailed(locale, '')
}

/** A basename only. An empty name or a path uses the sentence with no file name. */
function openFailed(locale: Locale, name: string): string {
  if (name.length > 0 && !name.includes('/') && !name.includes('\\')) {
    return translate(locale, 'file.openFailed', { name })
  }
  return translate(locale, 'file.openFailedGeneric')
}

/** A raw error message can contain a path. Keep only an error code, or one generic sentence. */
function loggedOpenFailure(error: Error, locale: Locale): string {
  const code = 'code' in error && typeof error.code === 'string' ? error.code : ''
  if (/^[A-Z][A-Z0-9_]*$/.test(code)) return code
  return translate(locale, 'file.openFailedGeneric')
}
