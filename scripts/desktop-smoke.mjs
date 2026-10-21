/* global Buffer, clearTimeout, console, fetch, process, setTimeout, WebSocket */
/**
 * Install a packaged desktop build, wait until /api/v1/health returns 200,
 * quit the app, and fail if the sidecar process is still running.
 *
 * macOS reads the loopback HTTP exchange. Windows asks the WebView2 page.
 * Neither path prints the launch token or the auth code.
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const HEALTH_MS = 60_000
const STOP_MS = 10_000

export function chooseInstaller(platform, names) {
  if (platform === 'macos') {
    const dmg = names.find((name) => name.endsWith('.dmg'))
    if (!dmg) throw new Error('macOS dmg is missing')
    return dmg
  }
  if (platform === 'windows') {
    const setup = names.find((name) => name.toLowerCase().endsWith('-setup.exe'))
    if (!setup) throw new Error('Windows NSIS installer is missing')
    return setup
  }
  throw new Error(`No desktop smoke install for ${platform}`)
}

/** True when a loopback capture saw the health request and its JSON body. */
export function healthCaptureProvesReady(capture) {
  return capture.includes('/api/v1/health') && capture.includes('"version":"0.1.0"')
}

export function redactSecrets(text) {
  return text
    .replace(/[0-9a-f]{64}/gi, '[redacted]')
    .replace(/(\?code=)[^&\s"']+/gi, '$1[redacted]')
    .replace(/(ert_launch=)[^;\s"']+/gi, '$1[redacted]')
}

export function tasklistShowsImage(output, image) {
  if (output.includes('No tasks')) return false
  return output.toLowerCase().includes(image.toLowerCase())
}

function walk(dir, found, descend) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (descend(entry.name)) walk(full, found, descend)
      continue
    }
    if (entry.isFile()) found.push(full)
  }
}

function filesUnder(dir) {
  const found = []
  walk(dir, found, () => true)
  return found
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function pgrepExact(name) {
  const result = spawnSync('pgrep', ['-x', name], { encoding: 'utf8' })
  return result.status === 0 && result.stdout.trim().length > 0
}

function sidecarRunningMac() {
  return pgrepExact('ert-server') || pgrepExact('ert-server-universal-apple-darwin')
}

function imageRunning(image) {
  const result = spawnSync('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' })
  return tasklistShowsImage(`${result.stdout ?? ''}\n${result.stderr ?? ''}`, image)
}

function sidecarRunningWindows() {
  return imageRunning('ert-server.exe') || imageRunning('ert-server-x86_64-pc-windows-msvc.exe')
}

async function waitFor(label, predicate) {
  const deadline = Date.now() + HEALTH_MS
  while (Date.now() < deadline) {
    if (await predicate()) return
    await sleep(500)
  }
  throw new Error(label)
}

function installMac(dmg) {
  const mount = path.join(os.tmpdir(), `ert-dmg-${process.pid}`)
  rmSync(mount, { recursive: true, force: true })
  mkdirSync(mount, { recursive: true })
  const attached = spawnSync('hdiutil', ['attach', '-nobrowse', '-mountpoint', mount, dmg], { encoding: 'utf8' })
  if (attached.status !== 0) throw new Error(attached.stderr || 'hdiutil attach failed')
  try {
    const found = []
    const scan = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const full = path.join(dir, entry.name)
        if (entry.name.endsWith('.app')) found.push(full)
        else scan(full)
      }
    }
    scan(mount)
    const bundle = found[0]
    if (!bundle) throw new Error(`No .app in ${dmg}`)
    const destRoot = path.join(os.tmpdir(), 'ert-smoke-app')
    rmSync(destRoot, { recursive: true, force: true })
    mkdirSync(destRoot, { recursive: true })
    const installed = path.join(destRoot, path.basename(bundle))
    const copied = spawnSync('cp', ['-R', bundle, installed], { encoding: 'utf8' })
    if (copied.status !== 0) throw new Error(copied.stderr || 'failed to copy the app')
    return installed
  } finally {
    spawnSync('hdiutil', ['detach', mount], { stdio: 'inherit' })
    rmSync(mount, { recursive: true, force: true })
  }
}

function startCapture() {
  const chunks = []
  const dump = spawn('sudo', ['-n', 'tcpdump', '-i', 'lo0', '-n', '-U', '-A', '-s', '0', '-l'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const take = (chunk) => chunks.push(Buffer.from(chunk))
  dump.stdout?.on('data', take)
  dump.stderr?.on('data', take)
  return {
    dump,
    text: () => Buffer.concat(chunks).toString('utf8'),
    stop() {
      spawnSync('sudo', ['-n', 'kill', String(dump.pid)])
    },
  }
}

async function smokeMac(dmg) {
  const app = installMac(dmg)
  spawnSync('xattr', ['-cr', app], { stdio: 'inherit' })
  const signed = spawnSync('codesign', ['--force', '--deep', '--sign', '-', app], { encoding: 'utf8' })
  if (signed.status !== 0) throw new Error(signed.stderr || 'codesign failed')
  const capture = startCapture()
  try {
    await sleep(1000)
    const opened = spawnSync('open', ['-n', app], { encoding: 'utf8' })
    if (opened.status !== 0) throw new Error(opened.stderr || 'open failed')
    try {
      await waitFor('did not observe /api/v1/health 200', async () => healthCaptureProvesReady(capture.text()))
    } catch (error) {
      console.error(redactSecrets(capture.text()).slice(-2000))
      throw error
    }
    if (!sidecarRunningMac()) throw new Error('sidecar process was not running')
    console.log('sidecar /api/v1/health returned 200')
    spawnSync('osascript', ['-e', 'tell application "Easy Race Timer" to quit'])
    const deadline = Date.now() + STOP_MS
    while (Date.now() < deadline && (sidecarRunningMac() || pgrepExact('easy-race-timer'))) {
      await sleep(300)
    }
    if (pgrepExact('easy-race-timer')) {
      const listed = spawnSync('pgrep', ['-x', 'easy-race-timer'], { encoding: 'utf8' })
      for (const pid of listed.stdout.trim().split(/\s+/).filter(Boolean)) {
        try {
          process.kill(Number(pid), 'SIGTERM')
        } catch {
          // The process can exit between pgrep and kill.
        }
      }
      await sleep(2000)
    }
    if (sidecarRunningMac()) throw new Error('sidecar still running after the app exited')
    console.log('sidecar exited with the app')
  } finally {
    capture.stop()
  }
}

function installWindows(setup) {
  const dest = 'C:\\ert-smoke'
  rmSync(dest, { recursive: true, force: true })
  const command = `"${setup}" /S /D=${dest}`
  const installed = spawnSync('cmd.exe', ['/d', '/c', command], { encoding: 'utf8' })
  if (installed.status !== 0) throw new Error(installed.stderr || installed.stdout || 'NSIS install failed')
  const exe = filesUnder(dest).find((file) => path.basename(file).toLowerCase() === 'easy-race-timer.exe')
  if (!exe) throw new Error(`easy-race-timer.exe was not installed under ${dest}`)
  return exe
}

function evaluateHealth(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error('cdp timeout'))
    }, 10_000)
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: "fetch('/api/v1/health',{credentials:'same-origin'}).then(r=>String(r.status))",
          awaitPromise: true,
          returnByValue: true,
        },
      }))
    })
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (message.id !== 1) return
      clearTimeout(timer)
      ws.close()
      resolve(message.result?.result?.value ?? '')
    })
    ws.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('cdp connection failed'))
    })
  })
}

async function smokeWindows(setup) {
  const exe = installWindows(setup)
  const child = spawn(exe, [], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9222',
    },
  })
  child.unref()
  await waitFor('did not observe /api/v1/health 200', async () => {
    try {
      const response = await fetch('http://127.0.0.1:9222/json/list')
      if (!response.ok) return false
      const pages = await response.json()
      const page = pages.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl)
      if (!page) return false
      const status = await evaluateHealth(page.webSocketDebuggerUrl)
      return status === '200'
    } catch {
      return false
    }
  })
  if (!sidecarRunningWindows()) throw new Error('sidecar process was not running')
  console.log('sidecar /api/v1/health returned 200')
  spawnSync('taskkill', ['/IM', 'easy-race-timer.exe'])
  const deadline = Date.now() + STOP_MS
  while (Date.now() < deadline && (sidecarRunningWindows() || imageRunning('easy-race-timer.exe'))) {
    await sleep(300)
  }
  if (imageRunning('easy-race-timer.exe')) spawnSync('taskkill', ['/IM', 'easy-race-timer.exe', '/T', '/F'])
  await sleep(2000)
  if (sidecarRunningWindows()) throw new Error('sidecar still running after the app exited')
  console.log('sidecar exited with the app')
}

function arg(name) {
  const index = process.argv.indexOf(name)
  const value = index === -1 ? '' : process.argv[index + 1]
  if (!value) throw new Error(`missing ${name}`)
  return value
}

async function main() {
  const platform = arg('--platform')
  const dist = arg('--dist')
  const names = filesUnder(dist).map((file) => path.relative(dist, file))
  const installer = path.resolve(dist, chooseInstaller(platform, names))
  if (!statSync(installer).isFile()) throw new Error(`installer is missing: ${installer}`)
  if (platform === 'macos') await smokeMac(installer)
  else if (platform === 'windows') await smokeWindows(installer)
  else throw new Error(`No desktop smoke install for ${platform}`)
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (import.meta.url === entry) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
