// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto'

/** CSPRNG used for the DEK, salts, nonces, file id and the recovery secret. Tests replace `bytes`. */
export const keyRandom = {
  bytes(size: number): Buffer {
    return randomBytes(size)
  },
}
