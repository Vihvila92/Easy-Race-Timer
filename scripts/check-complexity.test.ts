// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { baseRef, changedSources, diffCommands, isLeanSource, presentSources } from './check-complexity.js'

describe('changed sources', () => {
  it('keeps source files and drops everything else', () => {
    const names = changedSources(['packages/web/src/App.tsx\nREADME.md\n', 'scripts/lean-limits.js\nnode_modules/eslint/index.js\n'])
    expect(names).toEqual(['packages/web/src/App.tsx', 'scripts/lean-limits.js'])
    expect(isLeanSource('src-tauri/src/lib.rs')).toBe(false)
  })

  it('asks git for the branch diff, the worktree, and untracked files', () => {
    const commands = diffCommands('origin/main')
    expect(commands[0]).toEqual(['diff', '--name-only', '--diff-filter=ACMR', 'origin/main...HEAD'])
    expect(commands.some((args) => args[0] === 'ls-files')).toBe(true)
  })

  it('skips files that are no longer on disk', () => {
    expect(presentSources('/repo', ['keep.ts', 'gone.ts'], (file) => file.endsWith('keep.ts'))).toEqual(['keep.ts'])
  })

  it('defaults the base ref to origin/main', () => {
    expect(baseRef({})).toBe('origin/main')
    expect(baseRef({ LEAN_BASE_REF: 'origin/develop' })).toBe('origin/develop')
  })
})
