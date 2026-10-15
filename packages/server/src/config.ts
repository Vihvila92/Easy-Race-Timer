import path from 'node:path'

function forPlatform(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix
}

/** Directory for the SQLite file and its backups. An explicit ERT_DATA_DIR wins. */
export function resolveDataDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string {
  const configured = env.ERT_DATA_DIR?.trim()
  if (configured) return path.resolve(configured)
  const paths = forPlatform(platform)
  if (platform === 'win32') {
    const base = env.APPDATA?.trim() || paths.join(home, 'AppData', 'Roaming')
    return paths.join(base, 'Easy Race Timer')
  }
  if (platform === 'darwin') return paths.join(home, 'Library', 'Application Support', 'Easy Race Timer')
  const base = env.XDG_DATA_HOME?.trim() || paths.join(home, '.local', 'share')
  return paths.join(base, 'easy-race-timer')
}

/** ERT_DB is an explicit file path, used by tests. Otherwise the file is ert.sqlite in the data directory. */
export function resolveDbPath(env: NodeJS.ProcessEnv, dataDir: string): string {
  const file = env.ERT_DB?.trim()
  if (file) return path.resolve(file)
  return path.join(dataDir, 'ert.sqlite')
}

/**
 * Port to bind. An empty value or 0 asks the OS for a free local port.
 * A desktop shell leaves PORT unset and reads the chosen port from the ERT_READY line.
 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/**
 * A process with no PIN may listen only on loopback.
 * A configured PIN is what allows a wider bind.
 */
export function assertCanListen(host: string, pinConfigured: boolean): void {
  const name = host.trim().toLowerCase()
  if (pinConfigured || LOOPBACK_HOSTS.has(name)) return
  throw new Error(`Refusing to listen on ${host} until a PIN is set`)
}

export function resolveListenPort(env: NodeJS.ProcessEnv): number {
  const raw = env.PORT?.trim()
  if (!raw || raw === '0') return 0
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT must be an integer from 0 to 65535, got ${raw}`)
  }
  return port
}
