import { translate, type Locale } from '@ert/i18n'
import { RaceFileError } from '@ert/storage'

/**
 * One line for the process log when a race file will not open.
 * A newer file includes the guided hint. A bad key and a damaged file share one message.
 */
export function formatRaceFileError(error: unknown, locale: Locale = 'fi'): string {
  if (error instanceof RaceFileError) {
    if (error.kind === 'newer') return `${translate(locale, 'file.newer')} ${translate(locale, 'file.hint.newer')}`
    if (error.kind === 'dev-key') return error.message
    return translate(locale, 'file.openFailed', { name: error.fileName })
  }
  if (error instanceof Error) return error.message
  return translate(locale, 'file.openFailed', { name: 'race file' })
}
