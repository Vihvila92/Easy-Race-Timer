import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('desktop error page', () => {
  it('shows Finnish and English when the sidecar does not start', () => {
    const html = fs.readFileSync(path.resolve('src-tauri/shell/index.html'), 'utf8')
    expect(html).toMatch(/lang="fi"/)
    expect(html).toMatch(/lang="en"/)
    expect(html).toContain('Ohjelma ei käynnistynyt')
    expect(html).toContain('The program did not start')
    expect(html).not.toMatch(/<script/i)
  })
})
