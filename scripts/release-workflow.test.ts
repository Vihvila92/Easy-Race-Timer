// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const release = readFileSync('.github/workflows/release.yml', 'utf8')
const ci = readFileSync('.github/workflows/ci.yml', 'utf8')

function job(name: string): string {
  const match = release.split(new RegExp(`^ {2}${name}:`, 'm'))
  return match[1]?.split(/^ {2}[a-z]+:/m)[0] ?? ''
}

describe('release workflow', () => {
  it('defaults to contents read and pins every action to a commit SHA', () => {
    expect(release).toMatch(/^permissions:\n {2}contents: read\n/m)
    const uses = release.split('\n').filter((line) => line.includes('uses:'))
    expect(uses.length).toBeGreaterThan(0)
    for (const line of uses) {
      expect(line).toMatch(/uses: \S+@[0-9a-f]{40} # /)
    }
    expect(release).toContain('dtolnay/rust-toolchain@e2a55d2ffb04f378e9626c28d38b36d230d1e12f # master @ 2026-10-09')
  })

  it('builds on tags and workflow_dispatch, and only publish can write', () => {
    expect(release).toContain('workflow_dispatch:')
    expect(release).not.toContain('workflow_call:')
    expect(release).toMatch(/tags:\n\s+- ['"]v\*['"]/)
    expect(release).toMatch(/toolchain: ['"]1\.90\.0['"]/)
    expect(release).toContain('node-version: "22.23.3"')
    expect(release).toContain('pnpm rebuild esbuild')
    expect(release).toContain('better-sqlite3-multiple-ciphers')
    const plainModule = ['better', 'sqlite3'].join('-')
    expect(release).not.toContain(`pnpm rebuild ${plainModule} `)
    expect(release).toContain('pnpm build:sidecar')
    expect(release).toContain('rm -rf dist/sidecar')
    expect(release).toContain("cancel-in-progress: ${{ github.event_name != 'push' || github.ref_type != 'tag' }}")
    expect(release).toContain('TAURI_ENV_TARGET_TRIPLE: ${{ matrix.target }}')
    expect(release).toContain('ert-server-')
    expect(release).toContain('lipo -info')
    expect(release).toContain('file ')
    expect(job('installers')).toContain('lipo -info')
    expect(job('smoke')).toContain('desktop-smoke.mjs')
    expect(job('smoke')).toContain('macos-15')
    expect(job('smoke')).toContain('windows-2022')
    expect(job('smoke')).toContain('ubuntu-22.04')
    expect(job('smoke')).not.toContain('secrets.')
    const publish = job('publish')
    expect(publish).toContain('contents: write')
    expect(publish).toContain('id-token: write')
    expect(publish).toContain('attestations: write')
    expect(release).not.toMatch(/^ {2}check:/m)
    expect(job('installers')).not.toContain('secrets.')
    expect(job('sbom')).not.toContain('secrets.')
    expect(job('bundle')).not.toContain('secrets.')
  })

  it('checks out without credentials and disables the pnpm cache on tags', () => {
    const checkouts = release.match(/actions\/checkout@/g) ?? []
    const persisted = release.match(/persist-credentials: false/g) ?? []
    expect(checkouts.length).toBeGreaterThan(0)
    expect(persisted.length).toBe(checkouts.length)
    expect(release).not.toMatch(/^\s+cache: pnpm\s*$/m)
    expect(release).toContain("cache: ${{ github.ref_type != 'tag' && 'pnpm' || '' }}")
    expect(release).toContain("package-manager-cache: ${{ github.ref_type != 'tag' && 'true' || 'false' }}")
    expect(job('sign')).toContain('package-manager-cache: false')
  })

  it('pins runner images and ignores dependency scripts in the bundle job', () => {
    expect(release).not.toMatch(/ubuntu-latest|macos-latest|windows-latest/)
    expect(release).toContain('ubuntu-22.04')
    expect(release).toContain('ubuntu-24.04')
    expect(release).toContain('macos-15')
    expect(release).toContain('bundles: app,dmg')
    expect(release).toContain('windows-2022')
    expect(job('bundle')).toContain('pnpm install --frozen-lockfile --ignore-scripts')
    expect(job('bundle')).toContain('pnpm rebuild esbuild')
    const sbom = job('sbom')
    expect(sbom).toContain('pnpm install --frozen-lockfile --ignore-scripts')
    expect(sbom).not.toContain('pnpm dlx')
    expect(sbom).toContain('pnpm exec cdxgen')
    expect(readFileSync('package.json', 'utf8')).toContain('"@cyclonedx/cdxgen": "12.8.6"')
  })

  it('refuses to replace an existing release and attests updater files', () => {
    const publish = job('publish')
    expect(publish).not.toContain('--clobber')
    expect(publish).toContain('already exists')
    expect(publish).not.toContain('release upload')
    for (const subject of ['release/*.sig', 'release/latest.json', 'release/*.tar.gz', 'release/*.zip']) {
      expect(publish).toContain(subject)
    }
    const signatureCheck = publish.indexOf('verify-signatures --dir release')
    const releaseCreate = publish.indexOf('gh release create')
    expect(signatureCheck).toBeGreaterThan(-1)
    expect(releaseCreate).toBeGreaterThan(signatureCheck)
    expect(publish).not.toContain('TAURI_SIGNING')
    expect(publish).not.toMatch(/subject-path: release\/sbom-/)
    expect(publish).toContain('sbom-path: release/sbom-npm.cdx.json')
    expect(publish).toContain('sbom-path: release/sbom-cargo.cdx.json')
    const verify = job('verify')
    expect(verify).toContain('--clobber')
    expect(verify).toContain('assets/*.sig')
    expect(verify).toContain('assets/latest.json')
    expect(verify).toContain('assets/*.tar.gz')
    expect(verify).toContain('assets/checksums.txt')
    expect(verify).toContain('assets/sbom-npm.cdx.json')
    expect(verify).toContain('assets/sbom-cargo.cdx.json')
    expect(verify).toContain('--predicate-type https://cyclonedx.org/bom')
    expect(verify).toContain('verify-signatures')
    expect(verify).toContain('--signer-workflow Vihvila92/Easy-Race-Timer/.github/workflows/release.yml')
  })

  it('signs only on a tag push, from the release environment', () => {
    const sign = job('sign')
    expect(sign).toContain('environment: release')
    expect(sign).toContain("github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')")
    expect(sign).toContain('TAURI_SIGNING_PRIVATE_KEY')
    expect(sign).toContain('TAURI_SIGNING_PRIVATE_KEY_PASSWORD')
    expect(sign).not.toContain('TAURI_SIGNING_PUBLIC_KEY')
    expect(sign).toContain('merge-base --is-ancestor')
    expect(sign).toContain('GIT_CONFIG_COUNT=1')
    expect(sign).toContain('GIT_CONFIG_KEY_0=http.extraheader')
    expect(sign).toContain('GIT_CONFIG_VALUE_0="AUTHORIZATION: bearer ${GITHUB_TOKEN}"')
    expect(sign).not.toContain('git -c')
    expect(sign).toContain('tag="$GITHUB_REF_NAME"')
    expect(sign).toContain('signer sign')
    expect(sign).toContain('npm ci --ignore-scripts --no-audit --no-fund')
    expect(sign).not.toContain('npm install')
    expect(sign).not.toContain('pnpm install')
    const signerLock = JSON.parse(readFileSync('tools/tauri-signer/package-lock.json', 'utf8')) as {
      packages: Record<string, { version?: string; integrity?: string }>
    }
    const signerCli = signerLock.packages['node_modules/@tauri-apps/cli']
    expect(signerCli?.version).toBe('2.12.3')
    expect(signerCli?.integrity).toMatch(/^sha512-/)
    expect(release).not.toContain('TAURI_SIGNING_PUBLIC_KEY')
    const outside = release.replace(sign, '')
    expect(outside).not.toContain('TAURI_SIGNING_PRIVATE_KEY')
  })

  it('does not add installer work to the required check job', () => {
    expect(ci).toMatch(/^ {2}check:/m)
    expect(ci).not.toContain('tauri')
    expect(ci).not.toContain('rust-toolchain')
    expect(ci).not.toContain('attest')
  })
})
