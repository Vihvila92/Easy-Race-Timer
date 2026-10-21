import type { AppDb } from '@ert/storage'
import { openDatabase } from '@ert/storage'

export interface RaceDatabaseOptions {
  production: boolean
  env: NodeJS.ProcessEnv
}

/**
 * Open the race file.
 *
 * TODO(#130): PR #175 is not merged, so this still opens the plain SQLite file
 * and does not require a key. When the encrypted race file lands, open the
 * SQLCipher module here and unwrap the data key from a key slot in-process.
 * Never take that key from argv, the environment, or the ERT_READY line.
 */
export async function openRaceDatabase(filePath: string, options: RaceDatabaseOptions): Promise<AppDb> {
  if (options.production && (options.env.ERT_DB_KEY?.trim() || options.env.ERT_DEV_DB_KEY?.trim())) {
    throw new Error('Refusing a database key from the environment')
  }
  return openDatabase(filePath)
}
