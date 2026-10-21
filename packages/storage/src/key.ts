import { RaceFileError } from './errors.js'

/**
 * Fixed 32-byte key for development and tests.
 * It is not secret material. Production refuses it, including when a caller passes it explicitly.
 */
const DEV_DATA_KEY = Buffer.alloc(32, 0x11)

export interface OpenOptions {
  /** Raw 256-bit data key. Outside production, a missing key uses the dev provider. */
  dataKey?: Buffer
  /** Defaults to process.env. Tests use this to simulate production. */
  env?: NodeJS.ProcessEnv
}

export function assertDevKeyAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production') throw new RaceFileError('', 'dev-key')
}

/** Dev/test data key. Throws in production even if a flag is set. */
export function devDataKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  assertDevKeyAllowed(env)
  return Buffer.from(DEV_DATA_KEY)
}

export function resolveDataKey(options: OpenOptions = {}): Buffer {
  const env = options.env ?? process.env
  if (options.dataKey) {
    if (options.dataKey.length !== 32) throw new Error('Data key must be 32 bytes')
    if (env.NODE_ENV === 'production' && options.dataKey.equals(DEV_DATA_KEY)) {
      throw new RaceFileError('', 'dev-key')
    }
    return Buffer.from(options.dataKey)
  }
  return devDataKey(env)
}
