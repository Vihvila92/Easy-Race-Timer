import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const release = readFileSync('.github/workflows/release.yml', 'utf8')
const ci = readFileSync('.github/workflows/ci.yml', 'utf8')

describe('release workflow', () => {
  it('defaults to contents read and pins every action to a commit SHA', () => {
    expect(release).toMatch(/^permissions:\n {2}contents: read\n/m)
    const uses = release.split('\n').filter((line) => line.includes('uses:'))
    expect(uses.length).toBeGreaterThan(0)
    for (const line of uses) {
      expect(line).toMatch(/uses: \S+@[0-9a-f]{40} # /)
    }
  })

  it('builds on tags and workflow_dispatch, and only publish can write', () => {
    expect(release).toContain('workflow_dispatch:')
    expect(release).toMatch(/tags:\n\s+- ['"]v\*['"]/)
    expect(release).toContain('createUpdaterArtifacts')
    expect(release).toContain('TAURI_SIGNING_PRIVATE_KEY')
    expect(release).toContain('TAURI_SIGNING_PRIVATE_KEY_PASSWORD')
    expect(release).toMatch(/toolchain: ['"]1\.90\.0['"]/)
    const publish = release.split(/^ {2}verify:/m)[0]?.split(/^ {2}publish:/m)[1] ?? ''
    expect(publish).toContain('contents: write')
    expect(publish).toContain('id-token: write')
    expect(publish).toContain('attestations: write')
    expect(release).not.toMatch(/^ {2}check:/m)
  })

  it('does not add installer work to the required check job', () => {
    expect(ci).toMatch(/^ {2}check:/m)
    expect(ci).not.toContain('tauri')
    expect(ci).not.toContain('rust-toolchain')
    expect(ci).not.toContain('attest')
  })
})
