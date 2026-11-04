// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  cloneHash,
  duplicationProblems,
  missingAllowlistReasons,
  readJscpdReport,
  type Clone,
  type DuplicationReport,
} from './check-duplication.js'

function clone(fragment: string, tokens = 50): Clone {
  return { fragment, tokens, firstFile: 'a.ts', secondFile: 'b.ts', firstLine: 1, secondLine: 2 }
}

function report(clones: Clone[], percentage = 1, percentageTokens = 1): DuplicationReport {
  return { clones, percentage, percentageTokens }
}

describe('duplication budget', () => {
  it('accepts an allowlisted clone under 3%', () => {
    const item = clone('same')
    const allowed = [{ hash: cloneHash(item.fragment), files: 'a.ts | b.ts' }]
    const problems = duplicationProblems(report([item]), allowed)
    expect(problems.unexpected).toEqual([])
    expect(problems.stale).toEqual([])
    expect(problems.overBudget).toBe(false)
  })

  it('rejects a new clone and a stale allowlist entry', () => {
    const item = clone('fresh')
    const problems = duplicationProblems(report([item]), [{ hash: 'gone', files: 'old.ts' }])
    expect(problems.unexpected).toEqual([item])
    expect(problems.stale.map((entry) => entry.files)).toEqual(['old.ts'])
  })

  it('rejects duplication above 3% even when every clone is allowlisted', () => {
    const item = clone('same')
    const allowed = [{ hash: cloneHash(item.fragment), files: 'a.ts | b.ts' }]
    expect(duplicationProblems(report([item], 3, 3.01), allowed).overBudget).toBe(true)
    expect(duplicationProblems(report([item], 3, 3), allowed).overBudget).toBe(false)
  })
})

describe('jscpd report', () => {
  it('reads percentages and clone locations', () => {
    const parsed = readJscpdReport({
      duplicates: [{ fragment: 'body', tokens: 60, firstFile: { name: 'a.ts', start: 4 }, secondFile: { name: 'b.ts', start: 8 } }],
      statistics: { total: { percentage: 1.5, percentageTokens: 2 } },
    })
    expect(parsed.percentage).toBe(1.5)
    expect(parsed.clones[0]).toMatchObject({ firstFile: 'a.ts', firstLine: 4, secondFile: 'b.ts', secondLine: 8 })
  })
})

describe('allowlist reasons', () => {
  it('requires a comment immediately above each hash', () => {
    const source = ['// kept', "{ hash: 'abc', files: 'a.ts' },", '', "{ hash: 'def', files: 'b.ts' },"].join('\n')
    expect(missingAllowlistReasons(source)).toEqual(["{ hash: 'def', files: 'b.ts' },"])
  })

  it('accepts the committed allowlist', () => {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'duplication-allowlist.ts')
    expect(missingAllowlistReasons(readFileSync(file, 'utf8'))).toEqual([])
  })
})
