// SPDX-License-Identifier: AGPL-3.0-only
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertDirectoryPrivate, directoryIsPrivate, extractTree } from './sidecar-assets.js'

function embedded(bytes: Buffer): { files: Record<string, string>; hashes: Record<string, string> } {
  return {
    files: { 'index.html': bytes.toString('base64') },
    hashes: { 'index.html': crypto.createHash('sha256').update(bytes).digest('hex') },
  }
}

describe('sidecar asset extraction', () => {
  it('replaces a file whose hash does not match and refuses paths that leave the directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ert-assets-'))
    const dir = path.join(root, 'web')
    const payload = embedded(Buffer.from('<p>wizard</p>'))
    expect(extractTree(dir, payload.files, payload.hashes)).toBe(dir)
    expect(fs.readFileSync(path.join(dir, 'index.html'), 'utf8')).toBe('<p>wizard</p>')
    expect(fs.existsSync(path.join(dir, '.complete'))).toBe(false)
    fs.writeFileSync(path.join(dir, 'index.html'), 'changed')
    extractTree(dir, payload.files, payload.hashes)
    expect(fs.readFileSync(path.join(dir, 'index.html'), 'utf8')).toBe('<p>wizard</p>')
    expect(() => extractTree(path.join(root, 'other'), { '../escape.txt': Buffer.from('no').toString('base64') }, {})).toThrow(/Refusing/)
    expect(() => extractTree(path.join(root, 'other'), { '/tmp/abs.txt': Buffer.from('no').toString('base64') }, {})).toThrow(/Refusing/)
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('rejects mode 0777, accepts mode 0700, and classifies ownership without another user', () => {
    expect(directoryIsPrivate({ uid: 5, mode: 0o40777 }, 5)).toBe(false)
    expect(directoryIsPrivate({ uid: 5, mode: 0o40700 }, 5)).toBe(true)
    expect(directoryIsPrivate({ uid: 9, mode: 0o40700 }, 5)).toBe(false)
    expect(directoryIsPrivate({ uid: 5, mode: 0o40700 }, undefined)).toBe(true)
    if (process.platform === 'win32' || typeof process.getuid !== 'function') return
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ert-mode-'))
    fs.chmodSync(dir, 0o777)
    expect(() => assertDirectoryPrivate(dir)).toThrow(/not private/)
    fs.chmodSync(dir, 0o700)
    expect(() => assertDirectoryPrivate(dir)).not.toThrow()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('tightens a directory we own and stores the tree there', () => {
    if (process.platform === 'win32' || typeof process.getuid !== 'function') return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ert-repair-'))
    const dir = path.join(root, 'web')
    fs.mkdirSync(dir, { mode: 0o777 })
    fs.chmodSync(dir, 0o777)
    const payload = embedded(Buffer.from('ok'))
    extractTree(dir, payload.files, payload.hashes)
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700)
    expect(fs.readFileSync(path.join(dir, 'index.html'), 'utf8')).toBe('ok')
    fs.rmSync(root, { recursive: true, force: true })
  })
})
