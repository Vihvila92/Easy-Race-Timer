// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HEADER = 'SPDX-License-Identifier: AGPL-3.0-only'
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.css', '.py', '.html', '.rs'])
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', 'playwright-report', 'test-results', '.git', 'target', 'gen'])

export function sourceFiles(root: string): string[] {
  const found: string[] = []
  function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (EXTENSIONS.has(path.extname(name))) found.push(full)
    }
  }
  walk(root)
  return found.sort()
}

export function missingSpdxHeaders(root: string): string[] {
  return sourceFiles(root).flatMap((file) => {
    const head = readFileSync(file, 'utf8').split(/\r?\n/).slice(0, 5).join('\n')
    return head.includes(HEADER) ? [] : [path.relative(root, file)]
  })
}

if (!process.env.VITEST) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const missing = missingSpdxHeaders(root)
  if (missing.length) {
    console.error(`Missing ${HEADER} header:\n${missing.join('\n')}`)
    process.exit(1)
  }
  console.log(`SPDX headers ok (${sourceFiles(root).length} files)`)
}
