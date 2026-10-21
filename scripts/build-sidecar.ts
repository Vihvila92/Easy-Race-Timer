/**
 * Build the Node server as a Tauri sidecar: a Node 22 single executable
 * that includes the web UI and the better-sqlite3 native module.
 *
 * Output: src-tauri/binaries/ert-server-<target-triple>[.exe]
 * The `check` job does not run this script.
 */
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const nodeRequire = createRequire(import.meta.url)

function run(command: string, args: string[]) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit' })
}

function hostTriple(): string {
  const info = execFileSync('rustc', ['-vV'], { cwd: root, encoding: 'utf8' })
  const match = /^host: (\S+)/m.exec(info)
  if (!match?.[1]) throw new Error('rustc did not report a host triple')
  return match[1]
}

function prebuildName(): string {
  const arch = process.arch
  if (process.platform === 'linux') {
    const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined
    const musl = !report?.header?.glibcVersionRuntime
    return `${musl ? 'linuxmusl' : 'linux'}-${arch}.node`
  }
  if (process.platform === 'darwin' || process.platform === 'win32') return `${process.platform}-${arch}.node`
  throw new Error(`No better-sqlite3 sidecar prebuild for ${process.platform}-${arch}`)
}

function readTree(dir: string, prefix: string, files: Record<string, string>, accept: (rel: string) => boolean) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) readTree(full, rel, files, accept)
    else if (entry.isFile() && accept(rel)) files[rel] = fs.readFileSync(full).toString('base64')
  }
}

function hashFiles(files: Record<string, string>): string {
  const hash = crypto.createHash('sha256')
  for (const key of Object.keys(files).sort()) {
    hash.update(key)
    hash.update('\0')
    hash.update(files[key] ?? '')
    hash.update('\0')
  }
  return hash.digest('hex').slice(0, 16)
}

function sqliteFiles(): { hash: string; files: Record<string, string> } {
  const pkgRoot = path.dirname(nodeRequire.resolve('better-sqlite3/package.json'))
  const prebuild = prebuildName()
  const native = path.join(pkgRoot, 'prebuilds', prebuild)
  if (!fs.existsSync(native)) throw new Error(`Missing better-sqlite3 prebuild ${native}`)
  const files: Record<string, string> = {}
  readTree(path.join(pkgRoot, 'lib'), 'lib', files, (rel) => rel.endsWith('.js'))
  files[`prebuilds/${prebuild}`] = fs.readFileSync(native).toString('base64')
  files['package.json'] = Buffer.from(JSON.stringify({
    name: 'better-sqlite3',
    main: 'lib/index.js',
    type: 'commonjs',
  })).toString('base64')
  return { hash: hashFiles(files), files }
}

function webFiles(): { hash: string; files: Record<string, string> } {
  const dist = path.join(root, 'packages/web/dist')
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    throw new Error('packages/web/dist/index.html is missing. The web build did not run.')
  }
  const files: Record<string, string> = {}
  readTree(dist, '', files, () => true)
  return { hash: hashFiles(files), files }
}

function sqlitePlugin(payload: { hash: string; files: Record<string, string> }): esbuild.Plugin {
  return {
    name: 'better-sqlite3-prebuild',
    setup(build) {
      build.onResolve({ filter: /^better-sqlite3$/ }, () => ({ path: 'better-sqlite3', namespace: 'sqlite-prebuild' }))
      build.onLoad({ filter: /.*/, namespace: 'sqlite-prebuild' }, () => ({
        loader: 'js',
        resolveDir: path.join(root, 'scripts'),
        contents: `
          import { createRequire } from 'node:module'
          import os from 'node:os'
          import path from 'node:path'
          import { pathToFileURL } from 'node:url'
          import { extractTree } from './sidecar-assets.ts'
          const root = extractTree(path.join(os.tmpdir(), 'easy-race-timer', 'sqlite', ${JSON.stringify(payload.hash)}), ${JSON.stringify(payload.files)})
          const require = createRequire(pathToFileURL(process.execPath))
          export default require(path.join(root, 'lib', 'index.js'))
        `,
      }))
    },
  }
}

function webPlugin(payload: { hash: string; files: Record<string, string> }): esbuild.Plugin {
  return {
    name: 'web-assets',
    setup(build) {
      build.onResolve({ filter: /^virtual:web-assets$/ }, () => ({ path: 'virtual:web-assets', namespace: 'web-assets' }))
      build.onLoad({ filter: /.*/, namespace: 'web-assets' }, () => ({
        loader: 'js',
        contents: `export const hash = ${JSON.stringify(payload.hash)}\nexport const files = ${JSON.stringify(payload.files)}\n`,
      }))
    },
  }
}

const host = hostTriple()
const triple = process.env.TAURI_ENV_TARGET_TRIPLE?.trim() || host
if (triple !== host) {
  throw new Error(`This sidecar build only supports the host triple ${host}, not ${triple}`)
}

run('pnpm', ['--filter', '@ert/web', 'build'])
const sqlite = sqliteFiles()
const web = webFiles()
const outDir = path.join(root, 'dist/sidecar')
fs.mkdirSync(outDir, { recursive: true })
const bundle = path.join(outDir, 'server.cjs')

await esbuild.build({
  stdin: {
    contents: `
      import os from 'node:os'
      import path from 'node:path'
      import { extractTree } from './sidecar-assets.ts'
      import { startServer } from '../packages/server/src/index.ts'
      import { files, hash } from 'virtual:web-assets'
      const configured = process.env.ERT_WEB_DIST?.trim()
      if (!configured) {
        process.env.ERT_WEB_DIST = extractTree(path.join(os.tmpdir(), 'easy-race-timer', 'web', hash), files)
      }
      startServer().catch((error) => {
        console.error(error)
        process.exit(1)
      })
    `,
    resolveDir: path.join(root, 'scripts'),
    sourcefile: 'sidecar-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: bundle,
  legalComments: 'eof',
  plugins: [sqlitePlugin(sqlite), webPlugin(web)],
  logLevel: 'info',
})

const seaConfig = path.join(outDir, 'sea-config.json')
const blob = path.join(outDir, 'sea-prep.blob')
fs.writeFileSync(seaConfig, `${JSON.stringify({
  main: bundle,
  output: blob,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
}, null, 2)}\n`)
run(process.execPath, ['--experimental-sea-config', seaConfig])

const extension = process.platform === 'win32' ? '.exe' : ''
const binaries = path.join(root, 'src-tauri/binaries')
fs.mkdirSync(binaries, { recursive: true })
const sidecar = path.join(binaries, `ert-server-${triple}${extension}`)
fs.copyFileSync(process.execPath, sidecar)
fs.chmodSync(sidecar, 0o755)
run('pnpm', ['exec', 'postject', sidecar, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'])
fs.chmodSync(sidecar, 0o755)
console.log(`sidecar ${sidecar}`)
