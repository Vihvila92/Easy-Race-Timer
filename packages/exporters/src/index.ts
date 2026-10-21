// SPDX-License-Identifier: AGPL-3.0-only
import { RESULT_FIELDS, resultProjection, stringifyCsv, type ResultRow } from '@ert/core'
import { translate, type Locale } from '@ert/i18n'

export function exportResultsCsv(rows: ResultRow[], bom = true): string {
  return stringifyCsv(rows.map(resultProjection), [...RESULT_FIELDS], bom)
}

export interface PrintCategory {
  id: string
  raceId: string
  title: string
  ranked: boolean
}

export function exportPrintHtml(input: {
  eventName: string
  locale: Locale
  categories: PrintCategory[]
  rows: ResultRow[]
}): string {
  const t = (key: Parameters<typeof translate>[1]) => translate(input.locale, key)
  const sections = input.categories.map((category) => {
    const rows = input.rows.filter((row) => row.race === category.raceId && row.scope === category.id)
    if (!rows.length) return ''
    const body = rows.map((row) => `<tr>
      <td>${escapeHtml(row.rank)}</td>
      <td>${escapeHtml(row.bib)}</td>
      <td>${escapeHtml(row.name)}</td>
      <td>${escapeHtml(row.club_name || row.club_abbr)}</td>
      <td>${escapeHtml(row.time)}</td>
      <td>${escapeHtml(row.note)}</td>
    </tr>`).join('')
    return `<section class="sheet">
      <h1>${escapeHtml(input.eventName)}</h1>
      <h2>${escapeHtml(category.title)}</h2>
      <table>
        <thead><tr>
          <th>${t('results.overall') === 'Yleiset' ? 'Sija' : 'Place'}</th>
          <th>${t('entries.bib')}</th>
          <th>${t('entries.name')}</th>
          <th>${t('entries.club')}</th>
          <th>${input.locale === 'fi' ? 'Aika' : 'Time'}</th>
          <th>${t('results.note')}</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
    </section>`
  }).filter(Boolean)
  return `<!doctype html><html lang="${input.locale}"><head><meta charset="utf-8"><title>${escapeHtml(input.eventName)}</title>
  <style>
    @page { size: A4; margin: 16mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111; }
    .sheet { break-after: page; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #ccc; }
  </style></head><body>${sections.join('')}</body></html>`
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}
