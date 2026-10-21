/** Node copied into the sidecar, or downloaded when a universal macOS binary is built. */
export const NODE_VERSION = '22.23.3'

export interface NodeTarball {
  file: string
  sha256: string
}

/** SHA-256 values from https://nodejs.org/dist/v22.23.3/SHASUMS256.txt */
export const NODE_TARBALLS: Record<string, NodeTarball> = {
  'darwin-arm64': {
    file: 'node-v22.23.3-darwin-arm64.tar.gz',
    sha256: '23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53',
  },
  'darwin-x64': {
    file: 'node-v22.23.3-darwin-x64.tar.gz',
    sha256: '8a677b0219178efd6eb0e475457c4afb452b521a92f6e67845a73bd85727f2a8',
  },
  'linux-arm64': {
    file: 'node-v22.23.3-linux-arm64.tar.xz',
    sha256: 'a44aeb94849a299b22df10b9e622ec2f605c2183501bc40590705131de7c740f',
  },
  'linux-x64': {
    file: 'node-v22.23.3-linux-x64.tar.xz',
    sha256: 'df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de',
  },
  'win32-x64': {
    file: 'node-v22.23.3-win-x64.zip',
    sha256: '2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71',
  },
}

export const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'

export type SeaBuildKind =
  | { kind: 'host' }
  | { kind: 'universal-darwin' }
  | { kind: 'unsupported'; reason: string }

/**
 * `universal-apple-darwin` is two macOS binaries combined with lipo.
 * Any other triple must be the machine running the build.
 */
export function seaBuildKind(triple: string, hostTriple: string, platform: NodeJS.Platform): SeaBuildKind {
  if (triple === 'universal-apple-darwin') {
    if (platform !== 'darwin') {
      return { kind: 'unsupported', reason: 'The universal macOS sidecar is built on macOS' }
    }
    return { kind: 'universal-darwin' }
  }
  if (triple !== hostTriple) {
    return { kind: 'unsupported', reason: `This sidecar build only supports the host triple ${hostTriple}, not ${triple}` }
  }
  return { kind: 'host' }
}

/** The host copy path embeds `process.execPath`, so that binary must be the pinned version. */
export function assertHostNode(version: string): void {
  if (version !== `v${NODE_VERSION}`) {
    throw new Error(`The sidecar copies Node ${NODE_VERSION}; this process is ${version}`)
  }
}

/**
 * Command prefix that runs `binary` as `arch`.
 * On Apple Silicon the x64 slice must be `arch -x86_64` plus the x64 Node,
 * never the arm64 `process.execPath`.
 */
export function nodeLaunchArgs(binary: string, arch: string, hostArch: string, platform: NodeJS.Platform): string[] {
  if (platform === 'darwin' && arch !== hostArch) {
    const flag = arch === 'x64' ? '-x86_64' : arch === 'arm64' ? '-arm64' : ''
    if (!flag) throw new Error(`No Node launch prefix for ${arch}`)
    return ['arch', flag, binary]
  }
  return [binary]
}

/** `file` text for one thin Mach-O, not a universal binary that contains both. */
export function fileDescribesArch(output: string, arch: 'arm64' | 'x64'): boolean {
  const arm = /\barm64\b/.test(output)
  const intel = /\bx86_64\b/.test(output)
  if (arch === 'arm64') return arm && !intel
  return intel && !arm
}

/** `lipo -info` on the universal sidecar lists both slices. */
export function lipoInfoHasBoth(output: string): boolean {
  return /\bx86_64\b/.test(output) && /\barm64\b/.test(output)
}

/**
 * The Windows pnpm shim is `pnpm.cmd`. `execFile` does not run a `.cmd`
 * unless the command goes through `cmd.exe`. Native tools stay direct.
 */
export function needsShell(command: string, platform: NodeJS.Platform): boolean {
  return platform === 'win32' && command === 'pnpm'
}

/** Quote one argument for `cmd.exe /d /s /c`. */
export function quoteWindowsArg(arg: string): string {
  if (arg.length === 0) return '""'
  if (!/[\s"&|<>^]/.test(arg)) return arg
  return `"${arg.replaceAll('"', '""')}"`
}

/** One command line for `cmd.exe`, with paths that contain spaces left quoted. */
export function windowsCommandLine(command: string, args: string[]): string {
  return [command, ...args.map(quoteWindowsArg)].join(' ')
}
