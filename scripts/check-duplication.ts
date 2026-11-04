// SPDX-License-Identifier: AGPL-3.0-only
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { allowedClones, type AllowedClone } from './duplication-allowlist.js'

export const DUPLICATION_LIMIT_PERCENT = 3
export const MIN_CLONE_TOKENS = 50

export interface Clone {
  fragment: string
  tokens: number
  firstFile: string
  secondFile: string
  firstLine: number
  secondLine: number
}

export interface DuplicationReport {
  clones: Clone[]
  percentage: number
  percentageTokens: number
}

export interface DuplicationProblems {
  overBudget: boolean
  unexpected: Clone[]
  stale: AllowedClone[]
  duplicateHashes: string[]
}

export function cloneHash(fragment: string): string {
  return createHash('sha256').update(fragment).digest('hex')
}

export function missingAllowlistReasons(source: string): string[] {
  let reason = false
  const missing: string[] = []
  for (const line of source.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) {
      reason = false
      continue
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      reason = true
      continue
    }
    if (trimmed.includes("hash: '")) {
      if (!reason) missing.push(trimmed)
      continue
    }
    reason = false
  }
  return missing
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function textField(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value : ''
}

function lineField(record: Record<string, unknown>): number {
  const value = record.start
  return typeof value === 'number' ? value : 0
}

function cloneFrom(item: unknown): Clone {
  if (!isRecord(item)) throw new Error('jscpd clone is missing a fragment')
  const fragment = item.fragment
  const tokens = item.tokens
  if (typeof fragment !== 'string' || typeof tokens !== 'number') throw new Error('jscpd clone is missing a fragment')
  const first = isRecord(item.firstFile) ? item.firstFile : {}
  const second = isRecord(item.secondFile) ? item.secondFile : {}
  return {
    fragment,
    tokens,
    firstFile: textField(first, 'name'),
    secondFile: textField(second, 'name'),
    firstLine: lineField(first),
    secondLine: lineField(second),
  }
}

export function readJscpdReport(value: unknown): DuplicationReport {
  if (!isRecord(value)) throw new Error('jscpd report is empty')
  const duplicates = Array.isArray(value.duplicates) ? value.duplicates : []
  const statistics = isRecord(value.statistics) ? value.statistics : {}
  const total = isRecord(statistics.total) ? statistics.total : {}
  if (typeof total.percentage !== 'number' || typeof total.percentageTokens !== 'number') {
    throw new Error('jscpd report is missing duplication percentages')
  }
  return {
    clones: duplicates.map(cloneFrom),
    percentage: total.percentage,
    percentageTokens: total.percentageTokens,
  }
}

export function duplicateHashes(allowed: readonly AllowedClone[]): string[] {
  const seen = new Set<string>()
  const duplicates: string[] = []
  for (const item of allowed) {
    if (seen.has(item.hash)) duplicates.push(item.hash)
    seen.add(item.hash)
  }
  return duplicates
}

export function duplicationProblems(
  report: DuplicationReport,
  allowed: readonly AllowedClone[],
  limit = DUPLICATION_LIMIT_PERCENT,
): DuplicationProblems {
  const found = new Map<string, Clone>()
  for (const clone of report.clones) {
    if (clone.tokens < MIN_CLONE_TOKENS) continue
    found.set(cloneHash(clone.fragment), clone)
  }
  const allowedHashes = new Set(allowed.map((item) => item.hash))
  const unexpected = [...found.entries()].filter(([hash]) => !allowedHashes.has(hash)).map(([, clone]) => clone)
  const stale = allowed.filter((item) => !found.has(item.hash))
  const overBudget = report.percentage > limit || report.percentageTokens > limit
  return { overBudget, unexpected, stale, duplicateHashes: duplicateHashes(allowed) }
}

export function formatDuplication(report: DuplicationReport, problems: DuplicationProblems): string[] {
  const lines = [
    `duplication ${report.percentage.toFixed(2)}% of lines, ${report.percentageTokens.toFixed(2)}% of tokens (limit ${DUPLICATION_LIMIT_PERCENT}%)`,
  ]
  if (problems.overBudget) lines.push('duplication is above 3%')
  for (const clone of problems.unexpected) {
    lines.push(`new clone (${clone.tokens} tokens): ${clone.firstFile}:${clone.firstLine} | ${clone.secondFile}:${clone.secondLine}`)
  }
  for (const item of problems.stale) lines.push(`allowlist entry matches no clone: ${item.files}`)
  for (const hash of problems.duplicateHashes) lines.push(`duplicate allowlist hash: ${hash}`)
  return lines
}

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
}

function jscpdScript(): string {
  return createRequire(import.meta.url).resolve('jscpd/run-jscpd.js')
}

function runJscpd(root: string, output: string): DuplicationReport {
  const result = spawnSync(
    process.execPath,
    [jscpdScript(), '--config', '.jscpd.json', '--reporters', 'json', '--output', output, '--fail-on-empty', '.'],
    { cwd: root, encoding: 'utf8' },
  )
  const reportPath = path.join(output, 'jscpd-report.json')
  if (!existsSync(reportPath)) {
    const detail = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
    throw new Error(detail || `jscpd exited ${result.status ?? 1}`)
  }
  return readJscpdReport(JSON.parse(readFileSync(reportPath, 'utf8')))
}

function duplicationFailed(problems: DuplicationProblems): boolean {
  return problems.overBudget || problems.unexpected.length > 0 || problems.stale.length > 0 || problems.duplicateHashes.length > 0
}

function main(): void {
  const root = repoRoot()
  const output = mkdtempSync(path.join(tmpdir(), 'ert-jscpd-'))
  try {
    const missing = missingAllowlistReasons(readFileSync(path.join(root, 'scripts/duplication-allowlist.ts'), 'utf8'))
    if (missing.length) throw new Error(`allowlist entry without a reason comment:\n${missing.join('\n')}`)
    const report = runJscpd(root, output)
    const problems = duplicationProblems(report, allowedClones)
    const lines = formatDuplication(report, problems)
    console.log(lines[0])
    if (!duplicationFailed(problems)) return
    console.error(lines.slice(1).join('\n'))
    process.exitCode = 1
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  } finally {
    rmSync(output, { recursive: true, force: true })
  }
}

if (!process.env.VITEST) main()
