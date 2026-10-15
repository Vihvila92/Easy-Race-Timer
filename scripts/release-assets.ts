import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const REPO = 'Vihvila92/Easy-Race-Timer'

const INSTALLER_SUFFIXES = ['.msi', '.exe', '.dmg', '.AppImage', '.deb'] as const

export type ReleaseFile = {
  name: string
  signature?: string
}

export type LatestPlatform = {
  signature: string
  url: string
}

export type LatestDocument = {
  version: string
  notes: string
  pub_date: string
  platforms: Record<string, LatestPlatform>
}

export type OverlayInput = {
  eventName: string
  ref: string
  refName: string
  hasPrivateKey: boolean
  publicKeyFromEnv: string
  publicKeyFromConfig: string
}

export function isTagRelease(eventName: string, ref: string): boolean {
  return eventName === 'push' && ref.startsWith('refs/tags/v')
}

export function versionFromTag(refName: string): string {
  return refName.startsWith('v') ? refName.slice(1) : refName
}

export function releaseOverlay(input: OverlayInput): Record<string, unknown> {
  const overlay: Record<string, unknown> = {}
  const tagged = isTagRelease(input.eventName, input.ref)
  if (tagged) overlay.version = versionFromTag(input.refName)

  const pubkey = input.publicKeyFromEnv.trim() || input.publicKeyFromConfig.trim()
  if (input.hasPrivateKey && pubkey) {
    overlay.bundle = { createUpdaterArtifacts: true }
    overlay.plugins = { updater: { pubkey } }
  } else if (tagged) {
    throw new Error(
      'A v* tag release needs TAURI_SIGNING_PRIVATE_KEY, TAURI_SIGNING_PRIVATE_KEY_PASSWORD, and plugins.updater.pubkey (or TAURI_SIGNING_PUBLIC_KEY). Dry-run workflow_dispatch builds unsigned installers without those secrets.',
    )
  }
  return overlay
}

export function bundleDir(targetDir: string, platform: string): string {
  if (platform === 'macos') return path.join(targetDir, 'universal-apple-darwin', 'release', 'bundle')
  return path.join(targetDir, 'release', 'bundle')
}

export function isReleaseBundleFile(name: string): boolean {
  if (name.endsWith('.sig')) return true
  const lower = name.toLowerCase()
  if (lower.endsWith('.tar.gz')) return lower.endsWith('.app.tar.gz') || lower.endsWith('.appimage.tar.gz')
  if (lower.endsWith('.zip')) return lower.endsWith('.nsis.zip') || lower.endsWith('.msi.zip')
  return INSTALLER_SUFFIXES.some((suffix) => name.endsWith(suffix))
}

function walkFiles(dir: string, found: string[]) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.endsWith('.app') && entry.isDirectory()) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(full, found)
    else if (entry.isFile() && isReleaseBundleFile(entry.name)) found.push(full)
  }
}

export function collectBundles(targetDir: string, destDir: string, platform: string): string[] {
  const root = bundleDir(targetDir, platform)
  if (!existsSync(root)) throw new Error(`Tauri bundle directory not found: ${root}`)
  const found: string[] = []
  walkFiles(root, found)
  if (!found.length) throw new Error(`No installer files under ${root}`)
  mkdirSync(destDir, { recursive: true })
  const names: string[] = []
  for (const file of found) {
    const name = path.basename(file)
    const dest = path.join(destDir, name)
    if (existsSync(dest)) throw new Error(`Duplicate bundle filename: ${name}`)
    copyFileSync(file, dest)
    names.push(name)
  }
  assertPlatformInstallers(names, platform)
  return names.sort()
}

function assertPlatformInstallers(names: string[], platform: string) {
  const need =
    platform === 'linux' ? ['.AppImage', '.deb'] : platform === 'macos' ? ['.dmg'] : platform === 'windows' ? ['.msi', '.exe'] : []
  if (!need.length) throw new Error(`Unknown platform: ${platform}`)
  const missing = need.filter((suffix) => !names.some((name) => name.endsWith(suffix)))
  if (missing.length) throw new Error(`${platform} bundle is missing ${missing.join(', ')}`)
}

type SignatureAsset = {
  assetName: string
  signature: string
  os: string
  arch: string
  bundle: string
  priority: number
}

function classify(assetName: string): Pick<SignatureAsset, 'os' | 'arch' | 'bundle' | 'priority'> {
  const lower = assetName.toLowerCase()
  let os = 'linux'
  if (lower.endsWith('.app.tar.gz') || lower.endsWith('.dmg')) os = 'darwin'
  else if (lower.endsWith('.exe') || lower.endsWith('.msi') || lower.includes('.nsis.zip') || lower.includes('.msi.zip')) os = 'windows'

  let arch = 'x86_64'
  if (lower.includes('universal')) arch = 'universal'
  else if (lower.includes('aarch64') || lower.includes('arm64')) arch = 'aarch64'
  else if (lower.includes('x86_64') || lower.includes('amd64') || lower.includes('x64')) arch = 'x86_64'
  else if (lower.includes('i686') || /(?:^|[^a-z0-9])x86(?:[^0-9]|$)/.test(lower)) arch = 'i686'
  else if (lower.endsWith('.app.tar.gz')) arch = 'universal'

  let bundle = 'unknown'
  if (lower.endsWith('.app.tar.gz')) bundle = 'app'
  else if (lower.endsWith('.appimage.tar.gz') || lower.endsWith('.appimage')) bundle = 'appimage'
  else if (lower.includes('.nsis.zip') || lower.endsWith('.exe')) bundle = 'nsis'
  else if (lower.endsWith('.msi.zip') || lower.endsWith('.msi')) bundle = 'msi'
  else if (lower.endsWith('.deb')) bundle = 'deb'
  else if (lower.endsWith('.dmg')) bundle = 'dmg'

  return { os, arch, bundle, priority: updaterPriority(lower) }
}

function updaterPriority(lowerName: string): number {
  if (lowerName.endsWith('.app.tar.gz')) return 100
  if (lowerName.endsWith('.appimage.tar.gz')) return 100
  if (lowerName.endsWith('.nsis.zip')) return 90
  if (lowerName.endsWith('.msi.zip')) return 80
  if (lowerName.endsWith('.appimage')) return 50
  if (lowerName.endsWith('.exe')) return 40
  if (lowerName.endsWith('.msi')) return 30
  if (lowerName.endsWith('.deb')) return 20
  if (lowerName.endsWith('.dmg')) return 10
  return 0
}

export function releaseDownloadUrl(repo: string, tag: string, filename: string): string {
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(filename)}`
}

function archesFor(asset: SignatureAsset): string[] {
  if (asset.os === 'darwin' && asset.arch === 'universal') return ['universal', 'aarch64', 'x86_64']
  return [asset.arch]
}

export function buildLatestJson(options: {
  files: ReleaseFile[]
  version: string
  notes: string
  pubDate: string
  repo: string
  tag: string
}): LatestDocument | null {
  const names = new Set(options.files.map((file) => file.name))
  const signatures: SignatureAsset[] = []
  for (const file of options.files) {
    if (!file.name.endsWith('.sig') || file.signature == null) continue
    const assetName = file.name.slice(0, -'.sig'.length)
    if (!names.has(assetName)) throw new Error(`Signature ${file.name} has no matching file ${assetName}`)
    signatures.push({ assetName, signature: file.signature.trim(), ...classify(assetName) })
  }
  if (!signatures.length) return null

  const ranked = new Map<string, SignatureAsset>()
  const consider = (key: string, asset: SignatureAsset) => {
    const current = ranked.get(key)
    if (!current || asset.priority > current.priority) ranked.set(key, asset)
  }
  for (const asset of signatures) {
    for (const arch of archesFor(asset)) {
      consider(`${asset.os}-${arch}-${asset.bundle}`, asset)
      consider(`${asset.os}-${arch}`, asset)
    }
  }

  const platforms: Record<string, LatestPlatform> = {}
  for (const [key, asset] of ranked) {
    platforms[key] = {
      signature: asset.signature,
      url: releaseDownloadUrl(options.repo, options.tag, asset.assetName),
    }
  }
  const ordered = Object.fromEntries(Object.entries(platforms).sort(([a], [b]) => a.localeCompare(b)))
  return {
    version: options.version,
    notes: options.notes,
    pub_date: options.pubDate,
    platforms: ordered,
  }
}

export function checksumText(files: { name: string; bytes: Buffer }[]): string {
  return files
    .filter((file) => file.name !== 'checksums.txt')
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((file) => `${createHash('sha256').update(file.bytes).digest('hex')}  ${file.name}`)
    .join('\n')
    .concat('\n')
}

export function assertReleaseAssets(names: string[], updater: boolean) {
  const missing: string[] = INSTALLER_SUFFIXES.filter((suffix) => !names.some((name) => name.endsWith(suffix)))
  for (const name of ['sbom-npm.cdx.json', 'sbom-cargo.cdx.json', 'checksums.txt']) {
    if (!names.includes(name)) missing.push(name)
  }
  if (updater) {
    if (!names.includes('latest.json')) missing.push('latest.json')
    if (!names.some((name) => name.endsWith('.sig'))) missing.push('.sig')
  }
  if (missing.length) throw new Error(`Release assets are missing: ${missing.join(', ')}`)
}

export function flattenReleaseDir(dir: string) {
  const nested: string[] = []
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && current !== dir) nested.push(full)
    }
  }
  walk(dir)
  for (const file of nested) {
    const name = path.basename(file)
    const dest = path.join(dir, name)
    if (existsSync(dest)) throw new Error(`Cannot flatten duplicate filename: ${name}`)
    copyFileSync(file, dest)
    rmSync(file)
  }
}

function arg(name: string): string {
  const index = process.argv.indexOf(name)
  const value = index === -1 ? undefined : process.argv[index + 1]
  if (!value) {
    console.error(`Missing ${name}`)
    process.exit(1)
  }
  return value
}

function flag(name: string): boolean {
  return process.argv.includes(name)
}

function readConfigPubkey(): string {
  const conf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')) as {
    version?: string
    plugins?: { updater?: { pubkey?: string } }
  }
  return conf.plugins?.updater?.pubkey ?? ''
}

function readConfigVersion(): string {
  const conf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')) as { version?: string }
  return conf.version ?? '0.0.0'
}

function filesIn(dir: string): string[] {
  return readdirSync(dir).filter((name) => statSync(path.join(dir, name)).isFile())
}

function main() {
  const command = process.argv[2]
  if (command === 'overlay') {
    const out = arg('--out')
    const overlay = releaseOverlay({
      eventName: process.env.GITHUB_EVENT_NAME ?? '',
      ref: process.env.GITHUB_REF ?? '',
      refName: process.env.GITHUB_REF_NAME ?? '',
      hasPrivateKey: Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY),
      publicKeyFromEnv: process.env.TAURI_SIGNING_PUBLIC_KEY ?? '',
      publicKeyFromConfig: readConfigPubkey(),
    })
    writeFileSync(out, `${JSON.stringify(overlay)}\n`)
    return
  }
  if (command === 'collect') {
    const names = collectBundles(arg('--target'), arg('--dest'), arg('--platform'))
    console.log(names.join('\n'))
    return
  }
  if (command === 'latest') {
    const dir = arg('--dir')
    flattenReleaseDir(dir)
    const names = filesIn(dir)
    const files: ReleaseFile[] = names.map((name) => ({
      name,
      signature: name.endsWith('.sig') ? readFileSync(path.join(dir, name), 'utf8') : undefined,
    }))
    const tagged = isTagRelease(process.env.GITHUB_EVENT_NAME ?? '', process.env.GITHUB_REF ?? '')
    const version = tagged ? versionFromTag(process.env.GITHUB_REF_NAME ?? '') : readConfigVersion()
    const tag = tagged ? (process.env.GITHUB_REF_NAME ?? `v${version}`) : `v${version}`
    const latest = buildLatestJson({
      files,
      version,
      notes: `Easy Race Timer ${version}`,
      pubDate: new Date().toISOString(),
      repo: process.env.GITHUB_REPOSITORY || REPO,
      tag,
    })
    if (!latest) {
      console.log('No updater signatures; latest.json was not written')
      return
    }
    writeFileSync(path.join(dir, 'latest.json'), `${JSON.stringify(latest, null, 2)}\n`)
    console.log(`Wrote latest.json with ${Object.keys(latest.platforms).length} platform entries`)
    return
  }
  if (command === 'checksums') {
    const dir = arg('--dir')
    flattenReleaseDir(dir)
    const files = filesIn(dir)
      .filter((name) => name !== 'checksums.txt')
      .map((name) => ({ name, bytes: readFileSync(path.join(dir, name)) }))
    writeFileSync(path.join(dir, 'checksums.txt'), checksumText(files))
    console.log(`Wrote checksums.txt for ${files.length} files`)
    return
  }
  if (command === 'assert') {
    const dir = arg('--dir')
    assertReleaseAssets(filesIn(dir), flag('--updater'))
    console.log('Release assets are complete')
    return
  }
  console.error('Usage: release-assets.ts overlay|collect|latest|checksums|assert')
  process.exit(1)
}

const entry = process.argv[1] ?? ''
if (entry.endsWith('release-assets.ts') || entry.endsWith('release-assets.js')) main()
