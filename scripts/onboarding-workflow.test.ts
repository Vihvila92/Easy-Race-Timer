// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync('.github/workflows/onboarding.yml', 'utf8')

describe('onboarding workflow', () => {
  it('runs the documented quick start on three OSes', () => {
    expect(workflow).toMatch(/^permissions:\n {2}contents: read\n/m)
    expect(workflow).not.toContain('pull_request_target')
    for (const os of ['ubuntu-latest', 'windows-latest', 'macos-latest']) {
      expect(workflow).toContain(os)
    }
    expect(workflow).toContain('pnpm install --frozen-lockfile')
    expect(workflow).toContain('pnpm rebuild esbuild')
    expect(workflow).toContain('pnpm test')
    expect(workflow).toContain('pnpm check:lean')
    expect(workflow).toContain('node-version-file: .nvmrc')
    expect(workflow).toContain('0 6 * * 1')
    for (const path of ['CONTRIBUTING.md', '.nvmrc', 'rust-toolchain.toml', '.devcontainer/**', '.github/workflows/**']) {
      expect(workflow).toContain(path)
    }
    const uses = workflow.split('\n').filter((line) => line.includes('uses:'))
    expect(uses.length).toBeGreaterThan(0)
    for (const line of uses) {
      expect(line).toMatch(/uses: \S+@[0-9a-f]{40} # /)
    }
  })
})
