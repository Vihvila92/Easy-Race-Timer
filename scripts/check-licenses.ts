// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const allowed = new Set([
  'MIT',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  'ISC',
  'LGPL-2.0-only',
  'LGPL-2.1-only',
  'LGPL-3.0-only',
  'LGPL-2.0',
  'LGPL-2.1',
  'LGPL-3.0',
  '0BSD',
  'Unlicense',
  'CC0-1.0',
  'BlueOak-1.0.0',
  'Python-2.0',
  'MPL-2.0',
  'CC-BY-4.0',
  'UNLICENSED',
])

function licenseOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'type' in value && typeof value.type === 'string') return value.type
  return ''
}

function permits(license: string): boolean {
  if (!license || license === 'UNLICENSED') return true
  const parts = license.split(/\s+(?:OR|AND)\s+/i).map((part) => part.replace(/[()]/g, '').trim()).filter(Boolean)
  return parts.length > 0 && parts.every((part) => allowed.has(part))
}

const seen = new Map<string, string>()

function visit(dir: string) {
  const file = path.join(dir, 'package.json')
  if (!existsSync(file)) return
  const pkg = JSON.parse(readFileSync(file, 'utf8')) as { name?: string; license?: unknown; private?: boolean }
  if (!pkg.name || pkg.name.startsWith('@ert/') || pkg.name === 'easy-race-timer') return
  seen.set(pkg.name, licenseOf(pkg.license))
}

const store = path.join('node_modules', '.pnpm')
if (existsSync(store)) {
  for (const folder of readdirSync(store)) {
    const modules = path.join(store, folder, 'node_modules')
    if (!existsSync(modules)) continue
    for (const name of readdirSync(modules)) {
      if (name === '.bin') continue
      if (name.startsWith('@')) {
        for (const sub of readdirSync(path.join(modules, name))) visit(path.join(modules, name, sub))
      } else visit(path.join(modules, name))
    }
  }
}

const problems = [...seen.entries()].filter(([, license]) => !permits(license)).map(([name, license]) => `${name} ${license || '(none)'}`)
if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(`dependency licenses are on the allow list (${seen.size} packages)`)
