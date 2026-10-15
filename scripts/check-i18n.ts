import { ambiguousKeys, en, fi, mismatchedKeys } from '@ert/i18n'

const missing = mismatchedKeys(fi, en)
const ambiguous = ambiguousKeys(fi)
if (missing.length || ambiguous.length) {
  if (missing.length) console.error(`Missing translations: ${missing.join(', ')}`)
  if (ambiguous.length) console.error(`Keys that are both a leaf and a prefix: ${ambiguous.join(', ')}`)
  process.exit(1)
}
console.log('i18n catalogs match')
