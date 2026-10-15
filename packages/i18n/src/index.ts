import { en, fi, type MessageKey } from './catalog.js'

export type CategoryWarning =
  | { code: 'birth_year_only' }
  | { code: 'below_youngest'; age: number; categoryId: string }
  | { code: 'no_matching_category'; categoryId: string; categoryRaceId: string; enteredRaceId: string }
  | { code: 'no_category' }

export type Locale = 'fi' | 'en'
export type { MessageKey }

/** Stored language must be one of the supported locales. Anything else is Finnish. */
export function parseLocale(value: string | null | undefined): Locale {
  if (value === 'fi' || value === 'en') return value
  return 'fi'
}

const catalogs: Record<Locale, Record<MessageKey, string>> = { fi, en }

export function translate(locale: Locale, key: MessageKey, vars?: Record<string, string | number>): string {
  const template = catalogs[locale][key] ?? catalogs.fi[key] ?? key
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ''))
}

export function catalogKeys(): MessageKey[] {
  return Object.keys(fi) as MessageKey[]
}

export function missingKeys(locale: Locale): string[] {
  return catalogKeys().filter((key) => !catalogs[locale][key])
}

/** A leaf that is also a prefix of another key, such as `finish.hint` next to `finish.hint.keys`. */
export function ambiguousKeys(catalog: object): string[] {
  const keys = Object.keys(catalog as Record<string, unknown>)
  return keys.filter((key) => keys.some((other) => other.startsWith(`${key}.`))).sort()
}

/** Keys present in only one catalog. Names are the side that is missing the key. */
export function mismatchedKeys(left: object, right: object, leftName = 'fi', rightName = 'en'): string[] {
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const missing: string[] = []
  for (const key of Object.keys(leftRecord)) if (!(key in rightRecord)) missing.push(`${rightName}:${key}`)
  for (const key of Object.keys(rightRecord)) if (!(key in leftRecord)) missing.push(`${leftName}:${key}`)
  return missing
}

const intlLocale: Record<Locale, string> = { fi: 'fi-FI', en: 'en-GB' }

function toDate(value: Date | string | number): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (dateOnly) {
    const year = Number(dateOnly[1])
    const month = Number(dateOnly[2])
    const day = Number(dateOnly[3])
    const date = new Date(year, month - 1, day)
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
    return date
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatWith(value: Date | string | number, locale: Locale, options: Intl.DateTimeFormatOptions): string {
  const date = toDate(value)
  if (!date) return typeof value === 'string' ? value : ''
  return new Intl.DateTimeFormat(intlLocale[locale], options).format(date)
}

/** Calendar date. Finnish `15.10.2026`, English (en-GB) `15/10/2026`. Date-only strings stay on that civil day. */
export function formatDate(value: Date | string | number, locale: Locale): string {
  return formatWith(value, locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Time of day in 24-hour clock. Finnish `09.05`, English `09:05`. */
export function formatTime(value: Date | string | number, locale: Locale): string {
  return formatWith(value, locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

/** Date and time. Finnish `15.10.2026 klo 14.30`, English `15/10/2026, 14:30`. */
export function formatDateTime(value: Date | string | number, locale: Locale): string {
  return formatWith(value, locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
}

export function formatCategoryWarning(warning: CategoryWarning, locale: Locale = 'fi'): string {
  if (warning.code === 'birth_year_only') {
    return locale === 'en' ? 'only birth year → year age' : 'vain syntymävuosi -> vuosi-ikä'
  }
  if (warning.code === 'below_youngest') {
    return locale === 'en'
      ? `age ${warning.age} is below the youngest category, placed in ${warning.categoryId}`
      : `ikä ${warning.age} alle nuorimman sarjan, sijoitettu ${warning.categoryId}`
  }
  if (warning.code === 'no_matching_category') {
    return locale === 'en'
      ? `NO_MATCHING_CATEGORY: fitting category ${warning.categoryId} is on ${warning.categoryRaceId}, entered ${warning.enteredRaceId}`
      : `NO_MATCHING_CATEGORY: ikään sopiva sarja ${warning.categoryId} on matkalla ${warning.categoryRaceId}, ilmoittautunut ${warning.enteredRaceId}`
  }
  return locale === 'en' ? 'NO_MATCHING_CATEGORY: no fitting category' : 'NO_MATCHING_CATEGORY: ei sopivaa sarjaa'
}

export function formatWarnings(warnings: CategoryWarning[], locale: Locale = 'fi'): string {
  return warnings.map((warning) => formatCategoryWarning(warning, locale)).join(' | ')
}

export { fi, en }
