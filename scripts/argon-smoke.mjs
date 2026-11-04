// SPDX-License-Identifier: AGPL-3.0-only
/* global console, process */
/**
 * Run a built sidecar and ask it to hash one password with the embedded argon2
 * prebuild. The child prints `argon2 smoke ok` and nothing else.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const sidecar = process.argv[2]
if (!sidecar) {
  console.error('usage: node scripts/argon-smoke.mjs <sidecar>')
  process.exit(1)
}

function launch(binary) {
  if (process.platform !== 'darwin') return { command: binary, args: [] }
  const described = execFileSync('file', [binary], { encoding: 'utf8' })
  if (described.includes('x86_64') && !described.includes('arm64')) return { command: 'arch', args: ['-x86_64', binary] }
  return { command: binary, args: [] }
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ert-argon-'))
const started = launch(sidecar)
try {
  const output = execFileSync(started.command, started.args, {
    env: { ...process.env, ERT_ARGON2_SMOKE: '1', ERT_DATA_DIR: dataDir, NODE_ENV: 'production' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const lines = output.split(/\r?\n/).filter((line) => line.length > 0)
  if (lines.length !== 1 || lines[0] !== 'argon2 smoke ok') throw new Error('argon2 smoke failed')
  console.log('argon2 smoke ok')
} catch {
  console.error('argon2 smoke failed')
  process.exitCode = 1
} finally {
  fs.rmSync(dataDir, { recursive: true, force: true })
}
