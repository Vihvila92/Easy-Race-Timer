import { RaceFileError } from './errors.js'

/**
 * Fixed 32-byte key for development and tests.
 * It is not secret material. It is used only with an explicit opt-in, and never in production.
 */
const DEV_DATA_KEY = Buffer.alloc(32, 0x11)

export interface OpenOptions {
  /** Raw 256-bit data key. There is no implicit key. */
  dataKey?: Buffer
  /** Defaults to process.env. Tests use this to simulate production. */
  env?: NodeJS.ProcessEnv
}

let devKeyWarned = false

/** Test seam. Production never calls this. */
export function resetDevKeyWarning(): void {
  devKeyWarned = false
}

function warnDevKey(): void {
  if (devKeyWarned) return
  devKeyWarned = true
  console.warn('ERT_DEV_KEY is in use. This key is public and must not protect a real race file.')
}

/** Development or test, and only when the operator opted in. Production never qualifies. */
export function devKeyOptIn(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'production') return false
  return (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') && env.ERT_DEV_KEY === '1'
}

export function isDevDataKey(dataKey: Buffer): boolean {
  return dataKey.length === DEV_DATA_KEY.length && dataKey.equals(DEV_DATA_KEY)
}

export function assertDevKeyAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (!devKeyOptIn(env)) throw new RaceFileError('', env.NODE_ENV === 'production' ? 'dev-key' : 'missing-key')
}

/** Dev/test data key. Throws unless the opt-in is set, and always throws in production. */
export function devDataKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  assertDevKeyAllowed(env)
  warnDevKey()
  return Buffer.from(DEV_DATA_KEY)
}

export function resolveDataKey(options: OpenOptions = {}): Buffer {
  const env = options.env ?? process.env
  if (options.dataKey) {
    if (options.dataKey.length !== 32) throw new Error('Data key must be 32 bytes')
    if (isDevDataKey(options.dataKey)) {
      if (!devKeyOptIn(env)) throw new RaceFileError('', env.NODE_ENV === 'production' ? 'dev-key' : 'missing-key')
      warnDevKey()
    }
    return Buffer.from(options.dataKey)
  }
  if (!devKeyOptIn(env)) throw new RaceFileError('', env.NODE_ENV === 'production' ? 'dev-key' : 'missing-key')
  warnDevKey()
  return Buffer.from(DEV_DATA_KEY)
}
