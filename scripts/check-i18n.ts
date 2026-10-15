import { en, fi, mismatchedKeys } from '@ert/i18n'

const missing = mismatchedKeys(fi, en)
if (missing.length) {
  console.error(`Missing translations: ${missing.join(', ')}`)
  process.exit(1)
}
console.log('i18n catalogs match')
