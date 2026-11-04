// SPDX-License-Identifier: AGPL-3.0-only
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

export interface SizedFile {
  path: string
  bytes: number
  gzip: number
}

export interface AddedDependency {
  file: string
  packageName: string
  dependency: string
}

export interface WeightReport {
  frontend: SizedFile[]
  installers: SizedFile[]
  added: AddedDependency[]
}

export function gzipLength(bytes: Buffer): number {
  return gzipSync(bytes).length
}

export function runtimeDependencyNames(pkg: { dependencies?: Record<string, string> }): string[] {
  return Object.keys(pkg.dependencies ?? {}).sort()
}

export function addedNames(before: readonly string[], after: readonly string[]): string[] {
  const known = new Set(before)
  return after.filter((name) => !known.has(name))
}

export function addedDependencies(
  file: string,
  packageName: string,
  before: readonly string[],
  after: readonly string[],
): AddedDependency[] {
  return addedNames(before, after).map((dependency) => ({ file, packageName, dependency }))
}

export function dependencyWarnings(added: readonly AddedDependency[]): string[] {
  return added.map((item) => `::warning file=${item.file},title=New runtime dependency::${item.packageName} added ${item.dependency}`)
}

export function weightMarkdown(report: WeightReport): string {
  const lines = ['## Bundle and dependency weight', '', '### Frontend bundle', '', '| Asset | Raw bytes | Gzip bytes |', '| --- | ---: | ---: |']
  let raw = 0
  let gzip = 0
  for (const file of report.frontend) {
    lines.push(`| \`${file.path}\` | ${file.bytes} | ${file.gzip} |`)
    raw += file.bytes
    gzip += file.gzip
  }
  lines.push(`| **Total** | ${raw} | ${gzip} |`, '')
  lines.push('### Installer', '')
  if (report.installers.length === 0) {
    lines.push(
      'No installer packages in `src-tauri/target/release/bundle`. The check job does not build the sidecar or Tauri installers; the release workflow does.',
      '',
    )
  } else {
    lines.push('| Package | Raw bytes |', '| --- | ---: |')
    for (const file of report.installers) lines.push(`| \`${file.path}\` | ${file.bytes} |`)
    lines.push('')
  }
  lines.push('### Runtime dependencies', '')
  if (report.added.length === 0) lines.push('No new runtime dependencies.')
  for (const item of report.added) lines.push(`- \`${item.packageName}\` added \`${item.dependency}\``)
  lines.push('')
  return lines.join('\n')
}

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
}

export function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return []
  const found: string[] = []
  walkFiles(dir, found)
  return found.sort()
}

function walkFiles(dir: string, found: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(full, found)
    else if (entry.isFile()) found.push(full)
  }
}

export function measureGzip(root: string, relativePaths: readonly string[]): SizedFile[] {
  return relativePaths.map((rel) => {
    const bytes = readFileSync(path.join(root, rel))
    return { path: rel, bytes: bytes.length, gzip: gzipLength(bytes) }
  })
}

export function measureRaw(root: string, relativePaths: readonly string[]): SizedFile[] {
  return relativePaths.map((rel) => ({ path: rel, bytes: statSync(path.join(root, rel)).size, gzip: 0 }))
}

function ensureFrontend(root: string): void {
  if (existsSync(path.join(root, 'packages/web/dist/index.html'))) return
  execFileSync('pnpm', ['--filter', '@ert/web', 'build'], { cwd: root, stdio: 'inherit' })
}

function packageFiles(root: string): string[] {
  const files = ['package.json']
  for (const name of readdirSync(path.join(root, 'packages'))) {
    const rel = path.join('packages', name, 'package.json')
    if (existsSync(path.join(root, rel))) files.push(rel)
  }
  return files
}

function depsAt(root: string, ref: string, rel: string): string[] {
  try {
    const text = execFileSync('git', ['show', `${ref}:${rel}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return runtimeDependencyNames(JSON.parse(text) as { dependencies?: Record<string, string> })
  } catch {
    return []
  }
}

function newRuntimeDeps(root: string, ref: string): AddedDependency[] {
  const added: AddedDependency[] = []
  for (const rel of packageFiles(root)) {
    const current = JSON.parse(readFileSync(path.join(root, rel), 'utf8')) as { name?: string; dependencies?: Record<string, string> }
    const found = addedDependencies(rel, current.name ?? rel, depsAt(root, ref, rel), runtimeDependencyNames(current))
    added.push(...found)
  }
  return added
}

function relativeTo(root: string, files: readonly string[]): string[] {
  return files.map((file) => path.relative(root, file)).sort()
}

function publish(markdown: string, warnings: readonly string[]): void {
  console.log(markdown)
  for (const warning of warnings) console.log(warning)
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (!summary) return
  appendFileSync(summary, `${markdown}\n`)
}

function main(): void {
  const root = repoRoot()
  ensureFrontend(root)
  const frontend = measureGzip(root, relativeTo(root, filesUnder(path.join(root, 'packages/web/dist'))))
  const installers = measureRaw(root, relativeTo(root, filesUnder(path.join(root, 'src-tauri/target/release/bundle'))))
  const added = newRuntimeDeps(root, process.env.LEAN_BASE_REF || 'origin/main')
  publish(weightMarkdown({ frontend, installers, added }), dependencyWarnings(added))
}

if (!process.env.VITEST) main()
