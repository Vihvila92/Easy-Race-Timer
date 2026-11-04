// SPDX-License-Identifier: AGPL-3.0-only
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { leanRuleFlags } from './lean-limits.js'

const SOURCE = /\.(?:[cm]?js|tsx?)$/

export function baseRef(env: NodeJS.ProcessEnv = process.env): string {
  return env.LEAN_BASE_REF || 'origin/main'
}

export function isLeanSource(name: string): boolean {
  if (!SOURCE.test(name)) return false
  return !name.split('/').includes('node_modules')
}

export function changedSources(chunks: readonly string[]): string[] {
  const names = new Set<string>()
  for (const chunk of chunks) {
    for (const line of chunk.split('\n')) {
      const name = line.trim()
      if (isLeanSource(name)) names.add(name)
    }
  }
  return [...names].sort()
}

export function diffCommands(base: string): string[][] {
  return [
    ['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`],
    ['diff', '--name-only', '--diff-filter=ACMR', 'HEAD'],
    ['diff', '--name-only', '--cached', '--diff-filter=ACMR'],
    ['ls-files', '--others', '--exclude-standard'],
  ]
}

export function presentSources(root: string, names: readonly string[], exists: (file: string) => boolean = existsSync): string[] {
  return names.filter((name) => exists(path.join(root, name)))
}

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
}

function gitText(root: string, args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : ''
    throw new Error(`git ${args.join(' ')} failed\n${stderr}`.trim())
  }
}

function eslintScript(): string {
  const root = path.dirname(createRequire(import.meta.url).resolve('eslint/package.json'))
  return path.join(root, 'bin/eslint.js')
}

function lintChanged(root: string, files: readonly string[]): number {
  if (!files.length) {
    console.log('complexity ratchet: no changed source files')
    return 0
  }
  const result = spawnSync(process.execPath, [eslintScript(), ...leanRuleFlags('error'), ...files], {
    cwd: root,
    encoding: 'utf8',
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  return result.status ?? 1
}

function main(): void {
  const root = repoRoot()
  const base = baseRef()
  try {
    const chunks = diffCommands(base).map((args) => gitText(root, args))
    const files = presentSources(root, changedSources(chunks))
    process.exitCode = lintChanged(root, files)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

if (!process.env.VITEST) main()
