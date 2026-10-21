// SPDX-License-Identifier: AGPL-3.0-only
export interface Registered {
  id: string
}

export function createRegistry<T extends Registered>() {
  const items = new Map<string, T>()
  return {
    register(item: T) {
      items.set(item.id, item)
    },
    get(id: string): T | undefined {
      return items.get(id)
    },
    all(): T[] {
      return [...items.values()]
    },
  }
}

export type SportProfile = Registered & {
  rounding: 'floor_1s'
  startMode: string
  terminology: { fi: string; en: string }
  validateRace(input: { distanceM: number }): string[]
}

export type TimingSource = Registered & {
  clockModel: 'synchronized' | 'offset' | 'absolute'
  normalize(raw: { timeMs: number; bib?: number | null; mode?: string }): { timeMs: number; bib: number | null; mode: string }[]
}

export type RaceFormat = Registered & {
  startTimeFor(input: { massStartMs: number | null; categoryOffsetMs: number; entryOffsetMs: number; ownStartMs: number | null }): number | null
}

export type Exporter = Registered & {
  mediaType: string
  export(payload: unknown, locale: string): Uint8Array | string
}
