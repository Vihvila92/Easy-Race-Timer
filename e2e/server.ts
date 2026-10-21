import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import type { APIRequestContext } from '@playwright/test'

const root = path.resolve(import.meta.dirname, '..')

export interface RunningServer {
  child: ChildProcess
  port: number
  dbFile: string
}

export async function startServer(port: number, dbFile: string): Promise<RunningServer> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'packages/server/src/index.ts'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      ERT_DEV_KEY: '1',
      ERT_TEST_MODE: '1',
      ERT_DB: dbFile,
      ERT_WEB_DIST: path.join(root, 'packages/web/dist'),
      // One browser reloads the UI many times from this address. Production stays at 300 and 5.
      ERT_RATE_GLOBAL_MAX: '10000',
      ERT_RATE_STRICT_MAX: '10000',
      ERT_RATE_RECORDING_MAX: '10000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  const keep = (chunk: Buffer) => {
    log = (log + chunk.toString()).slice(-4000)
  }
  child.stdout?.on('data', keep)
  child.stderr?.on('data', keep)
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`server exited\n${log}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`)
      if (response.ok) return { child, port, dbFile }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }
  child.kill('SIGKILL')
  throw new Error(`server did not start\n${log}`)
}

/** Store the device-token cookie on this API client. A PIN is required once one is set. */
export async function authorize(request: APIRequestContext, pin?: string): Promise<void> {
  const response = await request.post('/api/v1/settings/pin/check', { data: pin ? { pin } : {} })
  if (!response.ok()) throw new Error(`PIN check failed ${response.status()} ${await response.text()}`)
}

export async function killServer(server: RunningServer): Promise<void> {
  if (server.child.exitCode != null) return
  server.child.kill('SIGKILL')
  await new Promise((resolve) => server.child.once('exit', resolve))
}
