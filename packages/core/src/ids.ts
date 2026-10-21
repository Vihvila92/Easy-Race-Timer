// SPDX-License-Identifier: AGPL-3.0-only
import { ulid } from 'ulid'

export function createId(): string {
  return ulid()
}

/** Monotonic enough for a single process: ulid() is time-ordered. */
export function createIds(count: number): string[] {
  return Array.from({ length: count }, () => ulid())
}
