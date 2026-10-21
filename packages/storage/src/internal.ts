// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Columns that stay inside the encrypted file.
 * Export, print and .ertx snapshots must not select them.
 * Print and spreadsheet coverage for every output format is #149 and #150.
 */
export const INTERNAL_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  entry: ['dsq_reason'],
}

export function omitInternal<T extends object>(table: string, row: T): T {
  const hidden = INTERNAL_COLUMNS[table]
  if (!hidden?.length) return row
  const copy = { ...row }
  for (const column of hidden) {
    delete (copy as Record<string, unknown>)[column]
  }
  return copy
}
