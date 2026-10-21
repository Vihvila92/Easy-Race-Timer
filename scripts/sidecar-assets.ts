// SPDX-License-Identifier: AGPL-3.0-only
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { ensurePrivateDirectory } from '../packages/server/src/private-dir.ts'

export { assertDirectoryPrivate, directoryIsPrivate, ensurePrivateDirectory } from '../packages/server/src/private-dir.ts'

/**
 * Write base64 assets under `root`. Every launch checks the SHA-256 of each
 * file against the hashes embedded in the binary. The tree is written beside
 * the destination and renamed into place.
 */
export function extractTree(root: string, files: Record<string, string>, hashes: Record<string, string>): string {
  const parent = path.dirname(root)
  ensurePrivateDirectory(parent)
  if (fs.existsSync(root)) {
    const existing = fs.lstatSync(root)
    if (existing.isSymbolicLink()) throw new Error('Refusing a linked asset directory')
    ensurePrivateDirectory(root)
    if (treeMatches(root, files, hashes)) return root
  }

  const staging = fs.mkdtempSync(path.join(parent, '.extract-'))
  try {
    if (process.platform !== 'win32') fs.chmodSync(staging, 0o700)
    for (const [rel, encoded] of Object.entries(files)) {
      const dest = safeJoin(staging, rel)
      const bytes = Buffer.from(encoded, 'base64')
      const actual = crypto.createHash('sha256').update(bytes).digest('hex')
      const expected = hashes[rel]
      if (!expected || actual !== expected) throw new Error(`Asset hash mismatch for ${rel}`)
      fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 })
      fs.writeFileSync(dest, bytes, { mode: 0o600 })
    }
    if (fs.existsSync(root)) {
      const aside = path.join(parent, `.aside-${crypto.randomBytes(6).toString('hex')}`)
      fs.renameSync(root, aside)
      try {
        fs.renameSync(staging, root)
      } catch (error) {
        try {
          if (!fs.existsSync(root)) fs.renameSync(aside, root)
        } catch {
          // The next launch replaces a partial tree when the hashes do not match.
        }
        throw error
      }
      fs.rmSync(aside, { recursive: true, force: true })
    } else {
      fs.renameSync(staging, root)
    }
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true })
    throw error
  }
  ensurePrivateDirectory(root)
  if (!treeMatches(root, files, hashes)) throw new Error('Extracted assets do not match embedded hashes')
  return root
}

export function safeJoin(root: string, rel: string): string {
  if (!rel || rel.includes('\0') || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) {
    throw new Error(`Refusing asset path ${rel}`)
  }
  const dest = path.resolve(root, rel)
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`
  if (dest !== root && !dest.startsWith(prefix)) {
    throw new Error(`Refusing asset path ${rel}`)
  }
  return dest
}

function treeMatches(root: string, files: Record<string, string>, hashes: Record<string, string>): boolean {
  const names = Object.keys(files).sort()
  const hashNames = Object.keys(hashes).sort()
  if (names.length !== hashNames.length || names.some((name, index) => name !== hashNames[index])) return false
  for (const rel of names) {
    let dest: string
    try {
      dest = safeJoin(root, rel)
    } catch {
      return false
    }
    if (!fs.existsSync(dest) || !fs.statSync(dest).isFile()) return false
    const actual = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex')
    if (actual !== hashes[rel]) return false
  }
  return true
}
