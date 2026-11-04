// SPDX-License-Identifier: AGPL-3.0-only
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type * as esbuild from 'esbuild'
import { fileDescribesArch, nodeLaunchArgs } from './sidecar-plan.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const nodeRequire = createRequire(import.meta.url)
const storageRequire = createRequire(path.join(root, 'packages/storage/package.json'))

export type Embedded = { files: Record<string, string>; hashes: Record<string, string> }

export function readTree(dir: string, prefix: string, files: Record<string, Buffer>, accept: (rel: string) => boolean) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) readTree(full, rel, files, accept)
    else if (entry.isFile() && accept(rel)) files[rel] = fs.readFileSync(full)
  }
}

export function embed(files: Record<string, Buffer>): Embedded {
  const encoded: Record<string, string> = {}
  const hashes: Record<string, string> = {}
  for (const [rel, bytes] of Object.entries(files)) {
    encoded[rel] = bytes.toString('base64')
    hashes[rel] = crypto.createHash('sha256').update(bytes).digest('hex')
  }
  return { files: encoded, hashes }
}

function sqlitePackageRoot(): string {
  return path.dirname(nodeRequire.resolve('better-sqlite3-multiple-ciphers/package.json'))
}

function prebuildName(platform: string, arch: string): string {
  if (platform === 'linux') {
    const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined
    const musl = !report?.header?.glibcVersionRuntime
    return `${musl ? 'linuxmusl' : 'linux'}-${arch}.node`
  }
  if (platform === 'darwin' || platform === 'win32') return `${platform}-${arch}.node`
  throw new Error(`No better-sqlite3-multiple-ciphers sidecar prebuild for ${platform}-${arch}`)
}

function sqlitePayload(native: { name: string; file: string }): Embedded {
  const files: Record<string, Buffer> = {}
  readTree(path.join(sqlitePackageRoot(), 'lib'), 'lib', files, (rel) => rel.endsWith('.js'))
  if (!fs.existsSync(native.file)) throw new Error(`Missing better-sqlite3-multiple-ciphers build ${native.file}`)
  files[`prebuilds/${native.name}`] = fs.readFileSync(native.file)
  files['package.json'] = Buffer.from(JSON.stringify({
    name: 'better-sqlite3-multiple-ciphers',
    main: 'lib/index.js',
    type: 'commonjs',
  }))
  return embed(files)
}

/** One published argon2 prebuild. The install script is skipped, so nothing is compiled. */
export function argonPrebuildRel(platform: string, arch: string, libc: 'glibc' | 'musl'): string {
  const named = `${platform}-${arch}`
  if (named === 'linux-x64' && libc === 'musl') return 'prebuilds/linux-x64/argon2.musl.node'
  if (named === 'linux-x64') return 'prebuilds/linux-x64/argon2.glibc.node'
  if (named === 'win32-x64') return 'prebuilds/win32-x64/argon2.glibc.node'
  if (named === 'darwin-arm64') return 'prebuilds/darwin-arm64/argon2.armv8.glibc.node'
  if (named === 'darwin-x64') return 'prebuilds/darwin-x64/argon2.glibc.node'
  throw new Error(`No argon2 prebuild for ${platform}-${arch}`)
}

export function sidecarLibc(platform: string, alpine: boolean): 'glibc' | 'musl' {
  if (platform === 'linux' && alpine) return 'musl'
  return 'glibc'
}

function argonPayload(platform: string, arch: string): Embedded {
  const argonRoot = path.dirname(storageRequire.resolve('argon2/package.json'))
  const nested = createRequire(path.join(argonRoot, 'package.json'))
  const gyp = path.dirname(nested.resolve('node-gyp-build/package.json'))
  const phc = path.dirname(nested.resolve('@phc/format/package.json'))
  const libc = sidecarLibc(platform, fs.existsSync('/etc/alpine-release'))
  const rel = argonPrebuildRel(platform, arch, libc)
  const native = path.join(argonRoot, rel)
  if (!fs.existsSync(native)) throw new Error(`Missing argon2 prebuild ${rel}`)
  const files: Record<string, Buffer> = {
    'argon2.cjs': fs.readFileSync(path.join(argonRoot, 'argon2.cjs')),
    'package.json': Buffer.from(JSON.stringify({ name: 'argon2', main: 'argon2.cjs', type: 'commonjs' })),
    [rel]: fs.readFileSync(native),
    'node_modules/node-gyp-build/node-gyp-build.js': fs.readFileSync(path.join(gyp, 'node-gyp-build.js')),
    'node_modules/node-gyp-build/package.json': Buffer.from(JSON.stringify({ name: 'node-gyp-build', main: 'node-gyp-build.js' })),
    'node_modules/@phc/format/index.js': fs.readFileSync(path.join(phc, 'index.js')),
    'node_modules/@phc/format/package.json': Buffer.from(JSON.stringify({ name: '@phc/format', main: 'index.js' })),
  }
  return embed(files)
}

function nativeLoader(resourceDir: string, entry: string, payload: Embedded): string {
  return `
    import { createRequire } from 'node:module'
    import os from 'node:os'
    import path from 'node:path'
    import { pathToFileURL } from 'node:url'
    import { extractTree } from './sidecar-assets.ts'
    import { resolveDataDir } from '../packages/server/src/config.ts'
    import { ensurePrivateDirectory } from '../packages/server/src/private-dir.ts'
    const files = ${JSON.stringify(payload.files)}
    const hashes = ${JSON.stringify(payload.hashes)}
    const dataDir = resolveDataDir(process.env, process.platform, os.homedir())
    ensurePrivateDirectory(dataDir)
    const extracted = extractTree(path.join(dataDir, 'resources', ${JSON.stringify(resourceDir)}), files, hashes)
    const require = createRequire(pathToFileURL(process.execPath))
    export default require(path.join(extracted, ${JSON.stringify(entry)}))
  `
}

function nativePlugin(input: { name: string; filter: RegExp; resourceDir: string; entry: string; payload: Embedded }): esbuild.Plugin {
  return {
    name: input.name,
    setup(build) {
      build.onResolve({ filter: input.filter }, () => ({ path: input.name, namespace: input.name }))
      build.onLoad({ filter: /.*/, namespace: input.name }, () => ({
        loader: 'js',
        resolveDir: path.join(root, 'scripts'),
        contents: nativeLoader(input.resourceDir, input.entry, input.payload),
      }))
    },
  }
}

export function sqlitePlugin(native: { name: string; file: string }): esbuild.Plugin {
  return nativePlugin({ name: 'sqlite-prebuild', filter: /^better-sqlite3-multiple-ciphers$/, resourceDir: 'sqlite', entry: 'lib/index.js', payload: sqlitePayload(native) })
}

export function argonPlugin(platform: string, arch: string): esbuild.Plugin {
  return nativePlugin({ name: 'argon2-prebuild', filter: /^argon2$/, resourceDir: 'argon2', entry: 'argon2.cjs', payload: argonPayload(platform, arch) })
}

export function sidecarEntry(): string {
  return `
    import os from 'node:os'
    import path from 'node:path'
    import Database from 'better-sqlite3-multiple-ciphers'
    import argon2 from 'argon2'
    import { extractTree } from './sidecar-assets.ts'
    import { startServer } from '../packages/server/src/index.ts'
    import { resolveDataDir } from '../packages/server/src/config.ts'
    import { ensurePrivateDirectory } from '../packages/server/src/private-dir.ts'
    import { files, hashes } from 'virtual:web-assets'
    if (!process.env.NODE_ENV) process.env.NODE_ENV = 'production'
    // ERT_ARGON2_SMOKE is readable in the shipped sidecar. Setting it is harmless:
    // the process hashes one password, opens an in-memory database, prints one
    // line, and exits. It does not open the race file and it does not print the hash.
    if (process.env.ERT_ARGON2_SMOKE === '1') {
      smokeArgon(argon2).catch(() => {
        console.error('argon2 smoke failed')
        process.exit(1)
      })
    } else {
      const configured = process.env.ERT_WEB_DIST?.trim()
      if (!configured) {
        const dataDir = resolveDataDir(process.env, process.platform, os.homedir())
        ensurePrivateDirectory(dataDir)
        process.env.ERT_WEB_DIST = extractTree(path.join(dataDir, 'resources', 'web'), files, hashes)
      }
      startServer().catch((error) => {
        console.error(error instanceof Error ? error.message : error)
        process.exit(1)
      })
    }
    async function smokeArgon(mod) {
      const hash = await mod.hash('smoke', { raw: true, type: mod.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1, hashLength: 32 })
      const hashOk = Buffer.isBuffer(hash) && hash.length === 32
      if (Buffer.isBuffer(hash)) hash.fill(0)
      if (!hashOk) throw new Error('argon2 smoke failed')
      const db = new Database(':memory:')
      try {
        const row = db.prepare('SELECT 1 AS ok').get()
        if (!row || row.ok !== 1) throw new Error('argon2 smoke failed')
      } finally {
        db.close()
      }
      console.log('argon2 smoke ok')
      process.exit(0)
    }
  `
}

function ensureRosetta(arch: string) {
  if (process.platform !== 'darwin' || arch === process.arch) return
  const flag = arch === 'x64' ? '-x86_64' : '-arm64'
  try {
    execFileSync('arch', [flag, 'true'], { stdio: 'ignore' })
  } catch {
    execFileSync('softwareupdate', ['--install-rosetta', '--agree-to-license'], { cwd: root, stdio: 'inherit' })
  }
}

export function assertFileArch(file: string, arch: 'arm64' | 'x64') {
  const output = execFileSync('file', [file], { encoding: 'utf8' })
  console.log(output.trim())
  if (!fileDescribesArch(output, arch)) throw new Error(`${file} is not a ${arch} binary`)
}

/** Compile better-sqlite3-multiple-ciphers with the Node that will run this slice, then keep that `.node`. */
export function rebuildSqlite(nodeBin: string, arch: string): { name: string; file: string } {
  ensureRosetta(arch)
  const pkgRoot = sqlitePackageRoot()
  const nodeGyp = nodeRequire.resolve('node-gyp/bin/node-gyp.js')
  const buildDir = path.join(pkgRoot, 'build')
  fs.rmSync(buildDir, { recursive: true, force: true })
  const name = prebuildName(process.platform, arch)
  console.log(`rebuilding better-sqlite3-multiple-ciphers for ${process.platform}-${arch} with ${nodeBin}`)
  const launch = nodeLaunchArgs(nodeBin, arch, process.arch, process.platform)
  const [command, ...prefix] = launch
  if (!command) throw new Error('missing node binary')
  execFileSync(command, [...prefix, nodeGyp, 'rebuild', '--release', '--force_build=1'], {
    cwd: pkgRoot,
    stdio: 'inherit',
    env: { ...process.env, npm_config_arch: arch },
  })
  const built = path.join(buildDir, 'Release', 'better_sqlite3.node')
  if (!fs.existsSync(built)) throw new Error(`better-sqlite3-multiple-ciphers rebuild did not produce ${built}`)
  const destDir = path.join(root, 'dist/sidecar/native')
  fs.mkdirSync(destDir, { recursive: true })
  const dest = path.join(destDir, name)
  fs.copyFileSync(built, dest)
  fs.rmSync(buildDir, { recursive: true, force: true })
  if (process.platform === 'darwin') assertFileArch(dest, arch === 'x64' ? 'x64' : 'arm64')
  else {
    try {
      console.log(execFileSync('file', [dest], { encoding: 'utf8' }).trim())
    } catch {
      console.log(`native ${dest}`)
    }
  }
  return { name, file: dest }
}
