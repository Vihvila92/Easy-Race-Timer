import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return files(full)
    if (full.endsWith('.test.ts')) return []
    return [full]
  })
}

describe('shipped UI', () => {
  it('does not name a host or a port', () => {
    const sources = [...files(path.join(web, 'src')), ...files(path.join(web, 'public'))]
    for (const file of sources) {
      const text = readFileSync(file, 'utf8')
      expect(text, file).not.toMatch(/127\.0\.0\.1|localhost:\d+|:8080/)
    }
  })
})
