// SPDX-License-Identifier: AGPL-3.0-only
export function parseIsoMs(iso: string): number {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) throw new Error(`Invalid timestamp: ${iso}`)
  return ms
}

export function parseIsoDate(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) throw new Error(`Invalid date: ${iso}`)
  return { year, month, day }
}

/** Display time, floored to whole seconds. Under an hour: M:SS. */
export function formatDuration(ms: number): string {
  const negative = ms < 0
  const total = Math.floor(Math.abs(ms) / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const clock = hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`
  return negative ? `-${clock}` : clock
}

/** Offset note uses a unicode minus, matching the Kuulan hölkkä oracle. */
export function formatOffsetNote(offsetMs: number): string {
  const sign = offsetMs < 0 ? '−' : '+'
  const total = Math.floor(Math.abs(offsetMs) / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const clock = hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`
  return `Siirretty lähtö ${sign}${clock}`
}

export function displaySeconds(timeMs: number): number {
  return Math.floor(timeMs / 1000)
}

export function addMonths(isoDate: string, months: number): string {
  const { year, month, day } = parseIsoDate(isoDate)
  const date = new Date(Date.UTC(year, month - 1 + months, day))
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
