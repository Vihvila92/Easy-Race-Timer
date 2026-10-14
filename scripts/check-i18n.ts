import { missingKeys } from '@ert/i18n'

const missing = [
  ...missingKeys('fi').map((key) => `fi:${key}`),
  ...missingKeys('en').map((key) => `en:${key}`),
]
if (missing.length) {
  console.error(`Missing translations: ${missing.join(', ')}`)
  process.exit(1)
}
console.log('i18n catalogs match')
