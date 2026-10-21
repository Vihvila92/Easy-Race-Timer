import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  NODE_TARBALLS,
  NODE_VERSION,
  SEA_FUSE,
  assertHostNode,
  fileDescribesArch,
  lipoInfoHasBoth,
  needsShell,
  nodeLaunchArgs,
  quoteWindowsArg,
  seaBuildKind,
  windowsCommandLine,
} from './sidecar-plan.js'

describe('sidecar build plan', () => {
  it('builds a universal macOS sidecar on darwin and refuses it elsewhere', () => {
    expect(seaBuildKind('universal-apple-darwin', 'aarch64-apple-darwin', 'darwin')).toEqual({ kind: 'universal-darwin' })
    expect(seaBuildKind('universal-apple-darwin', 'x86_64-unknown-linux-gnu', 'linux')).toEqual({
      kind: 'unsupported',
      reason: 'The universal macOS sidecar is built on macOS',
    })
  })

  it('allows only the host triple for every other target', () => {
    expect(seaBuildKind('x86_64-unknown-linux-gnu', 'x86_64-unknown-linux-gnu', 'linux')).toEqual({ kind: 'host' })
    expect(seaBuildKind('aarch64-apple-darwin', 'x86_64-unknown-linux-gnu', 'linux').kind).toBe('unsupported')
  })

  it('pins Node 22.23.3 and the published tarball checksums', () => {
    expect(NODE_VERSION).toBe('22.23.3')
    expect(() => assertHostNode('v22.23.3')).not.toThrow()
    expect(() => assertHostNode('v22.14.0')).toThrow(/22\.23\.3/)
    expect(NODE_TARBALLS['darwin-arm64']?.sha256).toBe('23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53')
    expect(NODE_TARBALLS['darwin-x64']?.sha256).toBe('8a677b0219178efd6eb0e475457c4afb452b521a92f6e67845a73bd85727f2a8')
    expect(NODE_TARBALLS['linux-arm64']?.sha256).toBe('a44aeb94849a299b22df10b9e622ec2f605c2183501bc40590705131de7c740f')
    expect(NODE_TARBALLS['linux-x64']?.sha256).toBe('df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de')
    expect(NODE_TARBALLS['win32-x64']?.sha256).toBe('2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71')
    for (const spec of Object.values(NODE_TARBALLS)) expect(spec.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('re-signs macOS binaries around postject and combines the universal pair with lipo', () => {
    const source = readFileSync(new URL('./build-sidecar.ts', import.meta.url), 'utf8')
    const plan = readFileSync(new URL('./sidecar-plan.ts', import.meta.url), 'utf8')
    expect(source).toContain('lipo')
    expect(source).toContain('lipo -info')
    expect(source).toContain('--force_build=1')
    expect(source).toContain('--macho-segment-name')
    expect(source).toContain('SEA_FUSE')
    expect(plan).toContain(SEA_FUSE)
    expect(source).toContain("'--sign', '-'")
    expect(source).toContain('darwin-arm64.node')
    expect(source).toContain('darwin-x64.node')
    expect(source).toContain('aarch64-apple-darwin')
    expect(source).toContain('x86_64-apple-darwin')
  })

  it('runs the x64 SEA config with the x64 Node, not the arm64 host', () => {
    expect(nodeLaunchArgs('/node/x64', 'x64', 'arm64', 'darwin')).toEqual(['arch', '-x86_64', '/node/x64'])
    expect(nodeLaunchArgs('/node/arm64', 'arm64', 'arm64', 'darwin')).toEqual(['/node/arm64'])
    expect(nodeLaunchArgs('/node/arm64', 'arm64', 'x64', 'darwin')).toEqual(['arch', '-arm64', '/node/arm64'])
    expect(nodeLaunchArgs('/usr/bin/node', 'x64', 'x64', 'linux')).toEqual(['/usr/bin/node'])
    expect(fileDescribesArch('Mach-O 64-bit executable x86_64', 'x64')).toBe(true)
    expect(fileDescribesArch('Mach-O 64-bit executable x86_64', 'arm64')).toBe(false)
    expect(fileDescribesArch('Mach-O 64-bit executable arm64', 'arm64')).toBe(true)
    expect(fileDescribesArch('Mach-O universal binary with 2 architectures: [x86_64] [arm64]', 'x64')).toBe(false)
    expect(lipoInfoHasBoth('Architectures in the fat file: x86_64 arm64')).toBe(true)
    expect(lipoInfoHasBoth('Non-fat file: arm64')).toBe(false)
  })

  it('runs pnpm through cmd.exe on Windows and quotes paths that contain spaces', () => {
    expect(needsShell('pnpm', 'win32')).toBe(true)
    expect(needsShell('pnpm', 'linux')).toBe(false)
    expect(needsShell('pnpm', 'darwin')).toBe(false)
    expect(needsShell('lipo', 'win32')).toBe(false)
    expect(quoteWindowsArg('')).toBe('""')
    expect(quoteWindowsArg('--filter')).toBe('--filter')
    expect(quoteWindowsArg('C:\\Program Files\\ert-server.exe')).toBe('"C:\\Program Files\\ert-server.exe"')
    expect(windowsCommandLine('pnpm', ['--filter', '@ert/web', 'build'])).toBe('pnpm --filter @ert/web build')
    expect(windowsCommandLine('pnpm', ['exec', 'postject', 'C:\\a b\\ert-server.exe', 'NODE_SEA_BLOB'])).toBe(
      'pnpm exec postject "C:\\a b\\ert-server.exe" NODE_SEA_BLOB',
    )
    const source = readFileSync(new URL('./build-sidecar.ts', import.meta.url), 'utf8')
    expect(source).toContain('needsShell')
    expect(source).toContain('windowsVerbatimArguments: true')
  })
})