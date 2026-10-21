// SPDX-License-Identifier: AGPL-3.0-only
import { createRegistry, type TimingSource } from '@ert/core'

export const touchButton: TimingSource = {
  id: 'touch',
  clockModel: 'synchronized',
  normalize(raw) {
    return [{ timeMs: raw.timeMs, bib: raw.bib ?? null, mode: raw.mode ?? 'time_first' }]
  },
}

export const manualEntry: TimingSource = {
  id: 'manual',
  clockModel: 'absolute',
  normalize(raw) {
    return [{ timeMs: raw.timeMs, bib: raw.bib ?? null, mode: 'manual' }]
  },
}

export const timingRegistry = createRegistry<TimingSource>()
timingRegistry.register(touchButton)
timingRegistry.register(manualEntry)
