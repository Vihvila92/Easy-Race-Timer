import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { holdExclusiveLock } from '@ert/storage'

const root = path.resolve(import.meta.dirname, '../../..')

describe('sidecar parent exit', () => {
  it('closes the port and the database after the parent is killed', async () => {
    if (process.platform === 'win32') return
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ert-parent-'))
    const parentPath = path.join(dataDir, 'parent.mjs')
    const token = 'ab'.repeat(32)
    const server = path.join(root, 'packages/server/src/index.ts')
    fs.writeFileSync(parentPath, `
      import { spawn } from 'node:child_process'
      const child = spawn(process.execPath, ['--import', 'tsx', ${JSON.stringify(server)}], {
        cwd: ${JSON.stringify(root)},
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          HOST: '127.0.0.1',
          PORT: '0',
          ERT_DATA_DIR: ${JSON.stringify(dataDir)},
          NODE_ENV: 'production',
        },
      })
      child.stdin.write(${JSON.stringify(token)} + '\\n')
      let buffer = ''
      child.stdout.on('data', (chunk) => {
        buffer += chunk.toString()
        const line = buffer.split('\\n').find((entry) => entry.startsWith('ERT_READY '))
        if (!line) return
        process.stdout.write(line + '\\n')
        process.stdout.write('CHILD ' + child.pid + '\\n', () => {
          process.kill(process.pid, 'SIGKILL')
        })
      })
    `)

    const parent = spawn(process.execPath, [parentPath], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    parent.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`parent did not report the child\n${output}`)), 30_000)
      parent.stdout?.on('data', () => {
        if (output.includes('CHILD ')) {
          clearTimeout(timer)
          resolve()
        }
      })
      parent.on('exit', () => {
        if (output.includes('CHILD ')) {
          clearTimeout(timer)
          resolve()
        }
      })
    })

    const ready = output.split('\n').find((line) => line.startsWith('ERT_READY '))
    const childLine = output.split('\n').find((line) => line.startsWith('CHILD '))
    if (!ready || !childLine) throw new Error(`parent output did not include the child\n${output}`)
    const payload = JSON.parse(ready.slice('ERT_READY '.length)) as { url?: string }
    const childPid = Number(childLine.slice('CHILD '.length))
    expect(payload.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(childPid).toBeGreaterThan(0)

    const deadline = Date.now() + 8_000
    while (Date.now() < deadline) {
      try {
        process.kill(childPid, 0)
      } catch {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    expect(() => process.kill(childPid, 0)).toThrow()
    await expect(fetch(`${payload.url}/api/v1/health`)).rejects.toThrow()
    const held = holdExclusiveLock(path.join(dataDir, 'server.lock'))
    held.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  })
})
