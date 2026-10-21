import { execFileSync } from 'node:child_process'
import { createHash, createPublicKey, verify } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { crc32 } from 'node:zlib'

/** Committed stand-in. The admin replaces it with the minisign public key. CI never supplies one. */
export const UPDATER_PUBKEY_PLACEHOLDER = 'TODO_REPLACE_WITH_UPDATER_PUBKEY'

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
}

export function isTagRelease(eventName: string, ref: string): boolean {
  return eventName === 'push' && ref.startsWith('refs/tags/v')
}

export function versionFromTag(refName: string): string {
  return refName.startsWith('v') ? refName.slice(1) : refName
}

export function releaseOverlay(input: OverlayInput): Record<string, unknown> {
  if (!isTagRelease(input.eventName, input.ref)) return {}
  // Version only. Updater archives are packed unsigned; the sign job writes .sig files.
  // The public key stays the committed plugins.updater.pubkey and is not overlaid from CI.
  return { version: versionFromTag(input.refName) }
}

export function assertRealUpdaterPubkey(pubkey: string): void {
  const value = pubkey.trim()
  if (!value || value === UPDATER_PUBKEY_PLACEHOLDER || value.includes('TODO')) {
    throw new Error(
      'plugins.updater.pubkey in src-tauri/tauri.conf.json is still a placeholder. Generate a key pair with `pnpm tauri signer generate`, commit the public key in place of TODO_REPLACE_WITH_UPDATER_PUBKEY, and store only the private key in the release GitHub environment. CI does not read the public key from a secret.',
    )
  }
  minisignPublicKey(value)
}

export function minisignPublicKey(tauriPubkey: string): { keyId: Buffer; key: Buffer } {
  const text = Buffer.from(tauriPubkey.trim(), 'base64').toString('utf8')
  const body = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('untrusted comment:'))
  if (!body) throw new Error('updater pubkey is not a minisign public key')
  const raw = Buffer.from(body, 'base64')
  if (raw.length < 42 || raw.subarray(0, 2).toString('utf8') !== 'Ed') {
    throw new Error('updater pubkey is not an Ed25519 minisign public key')
  }
  return { keyId: raw.subarray(2, 10), key: raw.subarray(10, 42) }
}

export function updaterSignatureMatches(pubkey: string, fileBytes: Buffer, sigFile: string): boolean {
  const publicKey = minisignPublicKey(pubkey)
  const text = Buffer.from(sigFile.trim(), 'base64').toString('utf8')
  const body = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('untrusted comment:') && !line.startsWith('trusted comment:'))
  if (!body) return false
  const raw = Buffer.from(body, 'base64')
  if (raw.length < 74) return false
  const algorithm = raw.subarray(0, 2).toString('utf8')
  // "ED" is minisign's prehashed Ed25519 (Blake2b-512). "Ed" signs the bytes directly.
  const signed =
    algorithm === 'ED' ? createHash('blake2b512').update(fileBytes).digest() : algorithm === 'Ed' ? fileBytes : null
  if (!signed) return false
  const keyId = raw.subarray(2, 10)
  const signature = raw.subarray(10, 74)
  if (!publicKey.keyId.equals(keyId)) return false
  const prefix = Buffer.from('302a300506032b6570032100', 'hex')
  const key = createPublicKey({ key: Buffer.concat([prefix, publicKey.key]), format: 'der', type: 'spki' })
  return verify(null, signed, key, signature)
}

function isUpdaterArchive(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.endsWith('.app.tar.gz') || lower.endsWith('.appimage.tar.gz') || lower.endsWith('.nsis.zip') || lower.endsWith('.msi.zip')
}

/** Fail closed. A placeholder public key, a bad signature, or a missing pair fails the tag. */
export function verifyUpdaterSignatures(dir: string, pubkey: string): string[] {
  assertRealUpdaterPubkey(pubkey)
  const names = filesIn(dir)
  const sigs = names.filter((name) => name.endsWith('.sig'))
  if (!sigs.length) throw new Error('No updater signatures to verify')
  const verified: string[] = []
  for (const sigName of [...sigs].sort()) {
    const assetName = sigName.slice(0, -'.sig'.length)
    const assetPath = path.join(dir, assetName)
    if (!existsSync(assetPath) || !statSync(assetPath).isFile()) {
      throw new Error(`Signature ${sigName} has no matching file ${assetName}`)
    }
    const ok = updaterSignatureMatches(pubkey, readFileSync(assetPath), readFileSync(path.join(dir, sigName), 'utf8'))
    if (!ok) throw new Error(`Signature ${sigName} does not match plugins.updater.pubkey`)
    verified.push(sigName)
  }
  const archives = names.filter(isUpdaterArchive)
  if (!archives.length) throw new Error('No updater archives to verify')
  for (const archive of archives) {
    if (!sigs.includes(`${archive}.sig`)) throw new Error(`Updater archive ${archive} has no signature`)
  }
  return verified
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

export function createUpdaterArchives(targetDir: string, platform: string): string[] {
  const root = bundleDir(targetDir, platform)
  if (!existsSync(root)) throw new Error(`Tauri bundle directory not found: ${root}`)
  const archives: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name.endsWith('.app')) {
          if (platform === 'macos') archives.push(writeTarGz(full))
          continue
        }
        walk(full)
        continue
      }
      if (!entry.isFile()) continue
      if (platform === 'linux' && entry.name.endsWith('.AppImage')) archives.push(writeTarGz(full))
      if (platform === 'windows' && entry.name.toLowerCase().endsWith('.exe') && path.basename(dir) === 'nsis') {
        archives.push(writeStoredZip(full, entry.name.replace(/\.exe$/i, '.nsis.zip')))
      }
      if (platform === 'windows' && entry.name.toLowerCase().endsWith('.msi') && path.basename(dir) === 'msi') {
        archives.push(writeStoredZip(full, entry.name.replace(/\.msi$/i, '.msi.zip')))
      }
    }
  }
  walk(root)
  const names = archives.map((file) => path.basename(file)).sort()
  const missing =
    platform === 'linux'
      ? names.some((name) => name.endsWith('.AppImage.tar.gz'))
        ? []
        : ['.AppImage.tar.gz']
      : platform === 'macos'
        ? names.some((name) => name.endsWith('.app.tar.gz'))
          ? []
          : ['.app.tar.gz']
        : platform === 'windows'
          ? ['.nsis.zip', '.msi.zip'].filter((suffix) => !names.some((name) => name.endsWith(suffix)))
          : [`unknown platform ${platform}`]
  if (missing.length) throw new Error(`${platform} updater archives are missing ${missing.join(', ')}`)
  return names
}

function writeTarGz(source: string): string {
  const dest = `${source}.tar.gz`
  execFileSync('tar', ['-czf', dest, '-C', path.dirname(source), path.basename(source)], { stdio: 'pipe' })
  return dest
}

export function storedZip(name: string, bytes: Buffer): Buffer {
  const filename = Buffer.from(name)
  const checksum = crc32(bytes) >>> 0
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(0, 8)
  local.writeUInt32LE(checksum, 14)
  local.writeUInt32LE(bytes.length, 18)
  local.writeUInt32LE(bytes.length, 22)
  local.writeUInt16LE(filename.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE((3 << 8) | 20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt32LE(checksum, 16)
  central.writeUInt32LE(bytes.length, 20)
  central.writeUInt32LE(bytes.length, 24)
  central.writeUInt16LE(filename.length, 28)
  central.writeUInt32LE(0o755 << 16, 38)
  const offset = 30 + filename.length + bytes.length
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(46 + filename.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([local, filename, bytes, central, filename, end])
}

function writeStoredZip(source: string, archiveName: string): string {
  const dest = path.join(path.dirname(source), archiveName)
  writeFileSync(dest, storedZip(path.basename(source), readFileSync(source)))
  return dest
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
    })
    writeFileSync(out, `${JSON.stringify(overlay)}\n`)
    return
  }
  if (command === 'collect') {
    const names = collectBundles(arg('--target'), arg('--dest'), arg('--platform'))
    console.log(names.join('\n'))
    return
  }
  if (command === 'pack') {
    const names = createUpdaterArchives(arg('--target'), arg('--platform'))
    console.log(names.join('\n'))
    return
  }
  if (command === 'assert-pubkey') {
    assertRealUpdaterPubkey(readConfigPubkey())
    console.log('Committed updater public key is not a placeholder')
    return
  }
  if (command === 'verify-signature') {
    const pubkey = readConfigPubkey()
    assertRealUpdaterPubkey(pubkey)
    const file = readFileSync(arg('--file'))
    const signature = readFileSync(arg('--sig'), 'utf8')
    if (!updaterSignatureMatches(pubkey, file, signature)) {
      console.error('The updater private key does not match plugins.updater.pubkey in src-tauri/tauri.conf.json')
      process.exit(1)
    }
    console.log('Updater private key matches the committed public key')
    return
  }
  if (command === 'verify-signatures') {
    const verified = verifyUpdaterSignatures(arg('--dir'), readConfigPubkey())
    console.log(`Verified ${verified.length} updater signatures against the committed public key`)
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
  console.error(
    'Usage: release-assets.ts overlay|pack|collect|latest|checksums|assert|assert-pubkey|verify-signature|verify-signatures',
  )
  process.exit(1)
}

const entry = process.argv[1] ?? ''
if (entry.endsWith('release-assets.ts') || entry.endsWith('release-assets.js')) main()
