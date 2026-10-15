import { en, fi, type MessageKey } from './catalog.js'

export type CategoryWarning =
  | { code: 'birth_year_only' }
  | { code: 'below_youngest'; age: number; categoryId: string }
  | { code: 'no_matching_category'; categoryId: string; categoryRaceId: string; enteredRaceId: string }
  | { code: 'no_category' }

export type Locale = 'fi' | 'en'
export type { MessageKey }

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
