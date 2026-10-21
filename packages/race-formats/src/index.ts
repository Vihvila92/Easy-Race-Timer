// SPDX-License-Identifier: AGPL-3.0-only
import { createRegistry, type RaceFormat } from '@ert/core'

/** Mass start plus a per-entry offset. An own start event, when present, wins. */
export const massStart: RaceFormat = {
  id: 'mass',
  startTimeFor(input) {
    if (input.ownStartMs != null) return input.ownStartMs
    if (input.massStartMs == null) return null
    return input.massStartMs + input.categoryOffsetMs + input.entryOffsetMs
  },
}

export const formatRegistry = createRegistry<RaceFormat>()
formatRegistry.register(massStart)
