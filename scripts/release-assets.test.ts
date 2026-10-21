// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  UPDATER_PUBKEY_PLACEHOLDER,
  assertRealUpdaterPubkey,
  assertReleaseAssets,
  buildLatestJson,
  checksumText,
  collectBundles,
  createUpdaterArchives,
  flattenReleaseDir,
  isTagRelease,
  releaseDownloadUrl,
  releaseOverlay,
  storedZip,
  updaterSignatureMatches,
  verifyUpdaterSignatures,
  versionFromTag,
} from './release-assets'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ert-release-'))
  dirs.push(dir)
  return dir
}

describe('release overlay', () => {
  it('treats only a pushed v* tag as a release', () => {
    expect(isTagRelease('push', 'refs/tags/v0.1.0')).toBe(true)
    expect(isTagRelease('workflow_dispatch', 'refs/tags/v0.1.0')).toBe(false)
    expect(isTagRelease('push', 'refs/heads/main')).toBe(false)
    expect(versionFromTag('v1.2.3-rc.1')).toBe('1.2.3-rc.1')
  })

  it('builds unsigned installers on a dry run', () => {
    expect(
      releaseOverlay({
        eventName: 'workflow_dispatch',
        ref: 'refs/heads/feature',
        refName: 'feature',
      }),
    ).toEqual({})
  })

  it('sets the tag version and does not take a public key from CI', () => {
    expect(
      releaseOverlay({
        eventName: 'push',
        ref: 'refs/tags/v0.2.0',
        refName: 'v0.2.0',
      }),
    ).toEqual({ version: '0.2.0' })
  })

  it('rejects the placeholder updater public key', () => {
    expect(() => assertRealUpdaterPubkey(UPDATER_PUBKEY_PLACEHOLDER)).toThrow(/placeholder/)
    expect(() => assertRealUpdaterPubkey('')).toThrow(/placeholder/)
    const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')) as {
      plugins: { updater: { pubkey: string } }
    }
    expect(config.plugins.updater.pubkey).toBe(UPDATER_PUBKEY_PLACEHOLDER)
  })
})

describe('bundle collection', () => {
  it('copies linux installers and ignores files outside the release bundle', () => {
    const root = tempDir()
    const bundle = path.join(root, 'target', 'release', 'bundle')
    mkdirSync(path.join(bundle, 'appimage'), { recursive: true })
    mkdirSync(path.join(bundle, 'deb'), { recursive: true })
    mkdirSync(path.join(root, 'target', 'debug', 'bundle', 'deb'), { recursive: true })
    writeFileSync(path.join(bundle, 'appimage', 'app_0.1.0_amd64.AppImage'), 'appimage')
    writeFileSync(path.join(bundle, 'appimage', 'app_0.1.0_amd64.AppImage.tar.gz'), 'tar')
    writeFileSync(path.join(bundle, 'deb', 'app_0.1.0_amd64.deb'), 'deb')
    writeFileSync(path.join(root, 'target', 'debug', 'bundle', 'deb', 'debug.deb'), 'nope')
    const dest = path.join(root, 'dist')
    expect(collectBundles(path.join(root, 'target'), dest, 'linux').sort()).toEqual([
      'app_0.1.0_amd64.AppImage',
      'app_0.1.0_amd64.AppImage.tar.gz',
      'app_0.1.0_amd64.deb',
    ])
  })

  it('keeps the universal macOS dmg and skips per-arch targets', () => {
    const root = tempDir()
    const universal = path.join(root, 'target', 'universal-apple-darwin', 'release', 'bundle')
    mkdirSync(path.join(universal, 'dmg'), { recursive: true })
    mkdirSync(path.join(universal, 'macos', 'Easy Race Timer.app'), { recursive: true })
    mkdirSync(path.join(root, 'target', 'aarch64-apple-darwin', 'release', 'bundle', 'dmg'), { recursive: true })
    writeFileSync(path.join(universal, 'dmg', 'Easy Race Timer_0.1.0_universal.dmg'), 'dmg')
    writeFileSync(path.join(universal, 'macos', 'Easy Race Timer.app.tar.gz'), 'tar')
    writeFileSync(path.join(universal, 'macos', 'Easy Race Timer.app', 'ignored.exe'), 'nope')
    writeFileSync(path.join(root, 'target', 'aarch64-apple-darwin', 'release', 'bundle', 'dmg', 'arm.dmg'), 'arm')
    const names = collectBundles(path.join(root, 'target'), path.join(root, 'dist'), 'macos')
    expect(names).toEqual(['Easy Race Timer.app.tar.gz', 'Easy Race Timer_0.1.0_universal.dmg'])
  })
})

describe('latest.json', () => {
  it('merges updater signatures into platform urls', () => {
    const latest = buildLatestJson({
      version: '0.1.0',
      notes: 'Easy Race Timer 0.1.0',
      pubDate: '2026-10-15T00:00:00.000Z',
      repo: 'Vihvila92/Easy-Race-Timer',
      tag: 'v0.1.0',
      files: [
        { name: 'app_0.1.0_amd64.AppImage.tar.gz' },
        { name: 'app_0.1.0_amd64.AppImage.tar.gz.sig', signature: ' linux-sig \n' },
        { name: 'app_0.1.0_amd64.deb' },
        { name: 'app_0.1.0_amd64.deb.sig', signature: 'deb-sig' },
        { name: 'Easy Race Timer_0.1.0_x64-setup.nsis.zip' },
        { name: 'Easy Race Timer_0.1.0_x64-setup.nsis.zip.sig', signature: 'win-sig' },
        { name: 'Easy Race Timer.app.tar.gz' },
        { name: 'Easy Race Timer.app.tar.gz.sig', signature: 'mac-sig' },
        { name: 'Easy Race Timer_0.1.0_universal.dmg' },
      ],
    })
    expect(latest?.platforms['linux-x86_64']).toEqual({
      signature: 'linux-sig',
      url: releaseDownloadUrl('Vihvila92/Easy-Race-Timer', 'v0.1.0', 'app_0.1.0_amd64.AppImage.tar.gz'),
    })
    expect(latest?.platforms['linux-x86_64-deb'].signature).toBe('deb-sig')
    expect(latest?.platforms['windows-x86_64'].url).toContain(
      encodeURIComponent('Easy Race Timer_0.1.0_x64-setup.nsis.zip'),
    )
    expect(latest?.platforms['darwin-aarch64'].signature).toBe('mac-sig')
    expect(latest?.platforms['darwin-x86_64'].signature).toBe('mac-sig')
    expect(latest?.platforms['darwin-universal-app'].signature).toBe('mac-sig')
  })

  it('returns null when nothing is signed', () => {
    expect(
      buildLatestJson({
        version: '0.1.0',
        notes: 'notes',
        pubDate: '2026-10-15T00:00:00.000Z',
        repo: 'Vihvila92/Easy-Race-Timer',
        tag: 'v0.1.0',
        files: [{ name: 'app.deb' }],
      }),
    ).toBeNull()
  })
})

describe('updater archives', () => {
  it('packs unsigned linux, macOS and windows updater archives', () => {
    const root = tempDir()
    const linux = path.join(root, 'linux', 'target')
    mkdirSync(path.join(linux, 'release', 'bundle', 'appimage'), { recursive: true })
    mkdirSync(path.join(linux, 'release', 'bundle', 'deb'), { recursive: true })
    writeFileSync(path.join(linux, 'release', 'bundle', 'appimage', 'app_0.1.0_amd64.AppImage'), 'appimage')
    writeFileSync(path.join(linux, 'release', 'bundle', 'deb', 'app_0.1.0_amd64.deb'), 'deb')
    expect(createUpdaterArchives(linux, 'linux')).toEqual(['app_0.1.0_amd64.AppImage.tar.gz'])
    const listed = execFileSync('tar', ['-tzf', path.join(linux, 'release', 'bundle', 'appimage', 'app_0.1.0_amd64.AppImage.tar.gz')], {
      encoding: 'utf8',
    })
    expect(listed.trim()).toBe('app_0.1.0_amd64.AppImage')

    const mac = path.join(root, 'mac', 'target')
    const app = path.join(mac, 'universal-apple-darwin', 'release', 'bundle', 'macos', 'Easy Race Timer.app', 'Contents')
    mkdirSync(app, { recursive: true })
    writeFileSync(path.join(app, 'Info.plist'), 'plist')
    expect(createUpdaterArchives(mac, 'macos')).toEqual(['Easy Race Timer.app.tar.gz'])

    const win = path.join(root, 'win', 'target')
    mkdirSync(path.join(win, 'release', 'bundle', 'nsis'), { recursive: true })
    mkdirSync(path.join(win, 'release', 'bundle', 'msi'), { recursive: true })
    const exe = 'Easy Race Timer_0.1.0_x64-setup.exe'
    const msi = 'Easy Race Timer_0.1.0_x64_en-US.msi'
    writeFileSync(path.join(win, 'release', 'bundle', 'nsis', exe), 'exe')
    writeFileSync(path.join(win, 'release', 'bundle', 'msi', msi), 'msi')
    expect(createUpdaterArchives(win, 'windows')).toEqual([
      'Easy Race Timer_0.1.0_x64-setup.nsis.zip',
      'Easy Race Timer_0.1.0_x64_en-US.msi.zip',
    ])
    const zip = readFileSync(path.join(win, 'release', 'bundle', 'nsis', 'Easy Race Timer_0.1.0_x64-setup.nsis.zip'))
    expect(zip.readUInt16LE(8)).toBe(0)
  })

  it('writes a stored zip and accepts a matching minisign signature', () => {
    const zip = storedZip('setup.exe', Buffer.from('exe'))
    expect(zip.readUInt32LE(0)).toBe(0x04034b50)
    expect(zip.readUInt16LE(8)).toBe(0)

    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const der = publicKey.export({ format: 'der', type: 'spki' })
    const raw = der.subarray(der.length - 32)
    const keyId = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])
    const pubkey = Buffer.from(`untrusted comment: minisign public key\n${Buffer.concat([Buffer.from('Ed'), keyId, raw]).toString('base64')}\n`).toString(
      'base64',
    )
    const message = Buffer.from('nonce')
    const signature = sign(null, message, privateKey)
    const sigFile = Buffer.from(
      `untrusted comment: signature from tauri secret key\n${Buffer.concat([Buffer.from('Ed'), keyId, signature]).toString('base64')}\ntrusted comment: timestamp:1\tfile:nonce\nAAAA\n`,
    ).toString('base64')
    expect(updaterSignatureMatches(pubkey, message, sigFile)).toBe(true)
    expect(updaterSignatureMatches(pubkey, Buffer.from('other'), sigFile)).toBe(false)
    const hashed = sign(null, createHash('blake2b512').update(message).digest(), privateKey)
    const hashedFile = Buffer.from(
      `untrusted comment: signature from tauri secret key\n${Buffer.concat([Buffer.from('ED'), keyId, hashed]).toString('base64')}\ntrusted comment: timestamp:1\tfile:nonce\tversion:0.1.0\nAAAA\n`,
    ).toString('base64')
    expect(updaterSignatureMatches(pubkey, message, hashedFile)).toBe(true)
    assertRealUpdaterPubkey(pubkey)

    const dir = tempDir()
    const archive = 'Easy Race Timer.app.tar.gz'
    writeFileSync(path.join(dir, archive), message)
    writeFileSync(path.join(dir, `${archive}.sig`), sigFile)
    expect(verifyUpdaterSignatures(dir, pubkey)).toEqual([`${archive}.sig`])
    expect(() => verifyUpdaterSignatures(dir, UPDATER_PUBKEY_PLACEHOLDER)).toThrow(/placeholder/)
    writeFileSync(path.join(dir, archive), Buffer.from('tampered'))
    expect(() => verifyUpdaterSignatures(dir, pubkey)).toThrow(/does not match/)
    writeFileSync(path.join(dir, archive), message)
    writeFileSync(path.join(dir, 'other.app.tar.gz'), message)
    expect(() => verifyUpdaterSignatures(dir, pubkey)).toThrow(/has no signature/)
  })
})

describe('checksums and layout', () => {
  it('writes sha256 lines sha256sum can check', () => {
    const text = checksumText([
      { name: 'b.txt', bytes: Buffer.from('b') },
      { name: 'a.txt', bytes: Buffer.from('a') },
      { name: 'checksums.txt', bytes: Buffer.from('skip') },
    ])
    expect(text).toBe(
      'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb  a.txt\n' +
        '3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d  b.txt\n',
    )
  })

  it('flattens nested artifact folders and checks the release set', () => {
    const dir = tempDir()
    mkdirSync(path.join(dir, 'installers-linux'))
    writeFileSync(path.join(dir, 'installers-linux', 'app.AppImage'), 'a')
    writeFileSync(path.join(dir, 'installers-linux', 'app.deb'), 'd')
    writeFileSync(path.join(dir, 'app.msi'), 'm')
    writeFileSync(path.join(dir, 'app.exe'), 'e')
    writeFileSync(path.join(dir, 'app.dmg'), 'g')
    writeFileSync(path.join(dir, 'sbom-npm.cdx.json'), '{}')
    writeFileSync(path.join(dir, 'sbom-cargo.cdx.json'), '{}')
    flattenReleaseDir(dir)
    expect(readFileSync(path.join(dir, 'app.AppImage'), 'utf8')).toBe('a')
    expect(() => assertReleaseAssets(['app.AppImage', 'app.deb', 'app.msi', 'app.exe', 'app.dmg', 'sbom-npm.cdx.json', 'sbom-cargo.cdx.json'], false)).toThrow(/checksums.txt/)
    assertReleaseAssets(
      ['app.AppImage', 'app.deb', 'app.msi', 'app.exe', 'app.dmg', 'sbom-npm.cdx.json', 'sbom-cargo.cdx.json', 'checksums.txt'],
      false,
    )
  })
})
