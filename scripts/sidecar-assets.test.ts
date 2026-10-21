import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractTree } from './sidecar-assets.js'

describe('sidecar asset extraction', () => {
  it('writes a tree once and refuses paths that leave the directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ert-assets-'))
    const dir = path.join(root, 'web')
    const files = {
      'index.html': Buffer.from('<p>wizard</p>').toString('base64'),
      'assets/app.js': Buffer.from('ok').toString('base64'),
    }
    expect(extractTree(dir, files)).toBe(dir)
    expect(fs.readFileSync(path.join(dir, 'index.html'), 'utf8')).toBe('<p>wizard</p>')
    fs.writeFileSync(path.join(dir, 'index.html'), 'changed')
    extractTree(dir, files)
    expect(fs.readFileSync(path.join(dir, 'index.html'), 'utf8')).toBe('changed')
    expect(() => extractTree(path.join(root, 'other'), { '../escape.txt': Buffer.from('no').toString('base64') })).toThrow(/Refusing/)
    fs.rmSync(root, { recursive: true, force: true })
  })
})
