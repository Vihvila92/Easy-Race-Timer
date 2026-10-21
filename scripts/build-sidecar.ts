// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Build the Node server as a Tauri sidecar: a Node 22.23.3 single executable
 * that includes the web UI and the better-sqlite3-multiple-ciphers native module.
 *
 * A universal macOS target compiles that module for arm64 and for x64,
 * generates each SEA blob with that architecture's Node, and combines the
 * executables with lipo. The `check` job does not run this script.
 * Do not embed a development key.
 */
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'
import {
  NODE_TARBALLS,
  NODE_VERSION,
  SEA_FUSE,
  assertHostNode,
  fileDescribesArch,
  lipoInfoHasBoth,
  nodeLaunchArgs,
  pnpmLaunch,
  seaBuildKind,
} from './sidecar-plan.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const nodeRequire = createRequire(import.meta.url)

function run(command: string, args: string[]) {
  if (command === 'pnpm') {
    const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path')
    const launch = pnpmLaunch(process.platform, pathKey ? process.env[pathKey] : undefined, fs.existsSync, process.execPath)
    execFileSync(launch.command, [...launch.prefix, ...args], { cwd: root, stdio: 'inherit', windowsHide: true })
    return
  }
  execFileSync(command, args, { cwd: root, stdio: 'inherit' })
}

function hostTriple(): string {
  const info = execFileSync('rustc', ['-vV'], { cwd: root, encoding: 'utf8' })
  const match = /^host: (\S+)/m.exec(info)
  if (!match?.[1]) throw new Error('rustc did not report a host triple')
  return match[1]
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

function readTree(dir: string, prefix: string, files: Record<string, Buffer>, accept: (rel: string) => boolean) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) readTree(full, rel, files, accept)
    else if (entry.isFile() && accept(rel)) files[rel] = fs.readFileSync(full)
  }
}

function embed(files: Record<string, Buffer>): { files: Record<string, string>; hashes: Record<string, string> } {
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

function sqlitePayload(natives: { name: string; file: string }[]): { files: Record<string, string>; hashes: Record<string, string> } {
  const pkgRoot = sqlitePackageRoot()
  const files: Record<string, Buffer> = {}
  readTree(path.join(pkgRoot, 'lib'), 'lib', files, (rel) => rel.endsWith('.js'))
  for (const native of natives) {
    if (!fs.existsSync(native.file)) throw new Error(`Missing better-sqlite3-multiple-ciphers build ${native.file}`)
    files[`prebuilds/${native.name}`] = fs.readFileSync(native.file)
  }
  files['package.json'] = Buffer.from(JSON.stringify({
    name: 'better-sqlite3-multiple-ciphers',
    main: 'lib/index.js',
    type: 'commonjs',
  }))
  return embed(files)
}

function webPayload(): { files: Record<string, string>; hashes: Record<string, string> } {
  const dist = path.join(root, 'packages/web/dist')
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    throw new Error('packages/web/dist/index.html is missing. The web build did not run.')
  }
  const files: Record<string, Buffer> = {}
  readTree(dist, '', files, () => true)
  return embed(files)
}

function sqlitePlugin(payload: { files: Record<string, string>; hashes: Record<string, string> }): esbuild.Plugin {
  return {
    name: 'sqlite-prebuild',
    setup(build) {
      build.onResolve({ filter: /^better-sqlite3-multiple-ciphers$/ }, () => ({ path: 'better-sqlite3-multiple-ciphers', namespace: 'sqlite-prebuild' }))
      build.onLoad({ filter: /.*/, namespace: 'sqlite-prebuild' }, () => ({
        loader: 'js',
        resolveDir: path.join(root, 'scripts'),
        contents: `
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
          const root = extractTree(path.join(dataDir, 'resources', 'sqlite'), files, hashes)
          const require = createRequire(pathToFileURL(process.execPath))
          export default require(path.join(root, 'lib', 'index.js'))
        `,
      }))
    },
  }
}

function webPlugin(payload: { files: Record<string, string>; hashes: Record<string, string> }): esbuild.Plugin {
  return {
    name: 'web-assets',
    setup(build) {
      build.onResolve({ filter: /^virtual:web-assets$/ }, () => ({ path: 'virtual:web-assets', namespace: 'web-assets' }))
      build.onLoad({ filter: /.*/, namespace: 'web-assets' }, () => ({
        loader: 'js',
        contents: `export const files = ${JSON.stringify(payload.files)}\nexport const hashes = ${JSON.stringify(payload.hashes)}\n`,
      }))
    },
  }
}

async function downloadVerified(url: string, dest: string, sha256: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok || !response.body) throw new Error(`Failed to download ${url}: ${response.status}`)
  const hash = crypto.createHash('sha256')
  const file = fs.createWriteStream(dest)
  const body = Readable.fromWeb(response.body)
  for await (const chunk of body) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    hash.update(bytes)
    if (!file.write(bytes)) await new Promise((resolve) => file.once('drain', resolve))
  }
  await new Promise<void>((resolve, reject) => file.end((error?: Error | null) => (error ? reject(error) : resolve())))
  const actual = hash.digest('hex')
  if (actual !== sha256) {
    fs.rmSync(dest, { force: true })
    throw new Error(`Checksum mismatch for ${url}`)
  }
}

async function nodeBinary(platform: string, arch: string, destDir: string): Promise<string> {
  const spec = NODE_TARBALLS[`${platform}-${arch}`]
  if (!spec) throw new Error(`No pinned Node ${NODE_VERSION} tarball for ${platform}-${arch}`)
  fs.mkdirSync(destDir, { recursive: true })
  const archive = path.join(destDir, spec.file)
  if (!fs.existsSync(archive)) {
    await downloadVerified(`https://nodejs.org/dist/v${NODE_VERSION}/${spec.file}`, archive, spec.sha256)
  } else {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex')
    if (actual !== spec.sha256) {
      fs.rmSync(archive, { force: true })
      await downloadVerified(`https://nodejs.org/dist/v${NODE_VERSION}/${spec.file}`, archive, spec.sha256)
    }
  }
  const extracted = path.join(destDir, `${platform}-${arch}`)
  fs.rmSync(extracted, { recursive: true, force: true })
  fs.mkdirSync(extracted, { recursive: true })
  if (spec.file.endsWith('.zip')) run('unzip', ['-q', archive, '-d', extracted])
  else run('tar', ['-xf', archive, '-C', extracted])
  const binaryName = platform === 'win32' ? 'node.exe' : path.join('bin', 'node')
  const matches = fs.readdirSync(extracted)
  const top = matches.find((entry) => fs.existsSync(path.join(extracted, entry, binaryName)))
  if (!top) throw new Error(`Node ${NODE_VERSION} archive did not contain ${binaryName}`)
  return path.join(extracted, top, binaryName)
}

function runNode(binary: string, arch: string, args: string[], cwd = root) {
  const launch = nodeLaunchArgs(binary, arch, process.arch, process.platform)
  const [command, ...prefix] = launch
  if (!command) throw new Error('missing node binary')
  execFileSync(command, [...prefix, ...args], { cwd, stdio: 'inherit', env: process.env })
}

function captureNode(binary: string, arch: string, args: string[]): string {
  const launch = nodeLaunchArgs(binary, arch, process.arch, process.platform)
  const [command, ...prefix] = launch
  if (!command) throw new Error('missing node binary')
  return execFileSync(command, [...prefix, ...args], { cwd: root, encoding: 'utf8' }).trim()
}

function assertFileArch(file: string, arch: 'arm64' | 'x64') {
  const output = execFileSync('file', [file], { encoding: 'utf8' })
  console.log(output.trim())
  if (!fileDescribesArch(output, arch)) throw new Error(`${file} is not a ${arch} binary`)
}

function ensureRosetta(arch: string) {
  if (process.platform !== 'darwin' || arch === process.arch) return
  const flag = arch === 'x64' ? '-x86_64' : '-arm64'
  try {
    execFileSync('arch', [flag, 'true'], { stdio: 'ignore' })
  } catch {
    run('softwareupdate', ['--install-rosetta', '--agree-to-license'])
  }
}

/** Compile better-sqlite3-multiple-ciphers with the Node that will run this slice, then keep that `.node`. */
function rebuildNative(nodeBin: string, arch: string): { name: string; file: string } {
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

function assertSliceNode(nodeBin: string, arch: string) {
  const version = captureNode(nodeBin, arch, ['-p', 'process.version'])
  const reported = captureNode(nodeBin, arch, ['-p', 'process.arch'])
  assertHostNode(version)
  if (reported !== arch) throw new Error(`Node ${nodeBin} reported ${reported}, expected ${arch}`)
  if (process.platform === 'darwin') assertFileArch(nodeBin, arch === 'x64' ? 'x64' : 'arm64')
  console.log(`sea node ${arch} ${version} ${nodeLaunchArgs(nodeBin, arch, process.arch, process.platform).join(' ')}`)
}

function generateBlob(nodeBin: string, arch: string, bundle: string, blob: string) {
  const seaConfig = blob.replace(/\.blob$/, '.json')
  fs.writeFileSync(seaConfig, `${JSON.stringify({
    main: bundle,
    output: blob,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
  }, null, 2)}\n`)
  console.log(`experimental-sea-config via ${nodeLaunchArgs(nodeBin, arch, process.arch, process.platform).join(' ')}`)
  runNode(nodeBin, arch, ['--experimental-sea-config', seaConfig])
}

async function buildBundle(
  outfile: string,
  native: { name: string; file: string },
  web: { files: Record<string, string>; hashes: Record<string, string> },
) {
  await esbuild.build({
    stdin: {
      contents: `
      import os from 'node:os'
      import path from 'node:path'
      import { extractTree } from './sidecar-assets.ts'
      import { startServer } from '../packages/server/src/index.ts'
      import { resolveDataDir } from '../packages/server/src/config.ts'
      import { ensurePrivateDirectory } from '../packages/server/src/private-dir.ts'
      import { files, hashes } from 'virtual:web-assets'
      if (!process.env.NODE_ENV) process.env.NODE_ENV = 'production'
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
    `,
      resolveDir: path.join(root, 'scripts'),
      sourcefile: 'sidecar-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile,
    legalComments: 'eof',
    plugins: [sqlitePlugin(sqlitePayload([native])), webPlugin(web)],
    logLevel: 'info',
  })
}

function injectSea(nodeBinary: string, blob: string, dest: string) {
  fs.copyFileSync(nodeBinary, dest)
  fs.chmodSync(dest, 0o755)
  const macho = process.platform === 'darwin'
  if (macho) run('codesign', ['--remove-signature', dest])
  const args = ['exec', 'postject', dest, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', SEA_FUSE]
  if (macho) args.push('--macho-segment-name', 'NODE_SEA')
  run('pnpm', args)
  if (macho) run('codesign', ['--sign', '-', '--force', dest])
  fs.chmodSync(dest, 0o755)
}

const host = hostTriple()
const triple = process.env.TAURI_ENV_TARGET_TRIPLE?.trim() || host
const plan = seaBuildKind(triple, host, process.platform)
if (plan.kind === 'unsupported') throw new Error(plan.reason)

assertHostNode(process.version)
run('pnpm', ['--filter', '@ert/web', 'build'])
const web = webPayload()
const outDir = path.join(root, 'dist/sidecar')
fs.mkdirSync(outDir, { recursive: true })

const extension = process.platform === 'win32' ? '.exe' : ''
const binaries = path.join(root, 'src-tauri/binaries')
fs.mkdirSync(binaries, { recursive: true })
const sidecar = path.join(binaries, `ert-server-${triple}${extension}`)

if (plan.kind === 'universal-darwin') {
  // Tauri compiles each arch on its own and looks up externalBin by that
  // triple. The fat file is what the release log checks with lipo.
  const slices = [
    { arch: 'arm64' as const, prebuild: 'darwin-arm64.node', triple: 'aarch64-apple-darwin' },
    { arch: 'x64' as const, prebuild: 'darwin-x64.node', triple: 'x86_64-apple-darwin' },
  ]
  const seas: string[] = []
  for (const slice of slices) {
    const nodeBin = await nodeBinary('darwin', slice.arch, outDir)
    assertSliceNode(nodeBin, slice.arch)
    const native = rebuildNative(nodeBin, slice.arch)
    if (native.name !== slice.prebuild) throw new Error(`Expected ${slice.prebuild}, built ${native.name}`)
    const bundle = path.join(outDir, `server-${slice.arch}.cjs`)
    const blob = path.join(outDir, `sea-prep-${slice.arch}.blob`)
    const sea = path.join(binaries, `ert-server-${slice.triple}`)
    await buildBundle(bundle, native, web)
    generateBlob(nodeBin, slice.arch, bundle, blob)
    injectSea(nodeBin, blob, sea)
    assertFileArch(sea, slice.arch)
    seas.push(sea)
  }
  const [armSea, intelSea] = seas
  if (!armSea || !intelSea) throw new Error('universal sidecar slices were not built')
  if (fs.existsSync(sidecar)) fs.rmSync(sidecar)
  run('lipo', ['-create', armSea, intelSea, '-output', sidecar])
  run('codesign', ['--sign', '-', '--force', sidecar])
  fs.chmodSync(sidecar, 0o755)
  const info = execFileSync('lipo', ['-info', sidecar], { encoding: 'utf8' })
  console.log(`lipo -info ${info.trim()}`)
  if (!lipoInfoHasBoth(info)) throw new Error(`lipo -info is missing an architecture: ${info.trim()}`)
  const described = execFileSync('file', [sidecar], { encoding: 'utf8' })
  console.log(described.trim())
} else {
  const arch = process.arch
  const native = rebuildNative(process.execPath, arch)
  const bundle = path.join(outDir, 'server.cjs')
  const blob = path.join(outDir, 'sea-prep.blob')
  await buildBundle(bundle, native, web)
  generateBlob(process.execPath, arch, bundle, blob)
  injectSea(process.execPath, blob, sidecar)
  try {
    console.log(execFileSync('file', [sidecar], { encoding: 'utf8' }).trim())
  } catch {
    console.log(`sidecar ${sidecar}`)
  }
}
console.log(`sidecar ${sidecar}`)
