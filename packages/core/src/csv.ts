/** Semicolon-separated CSV with RFC-style quotes. Strips a leading UTF-8 BOM. */

export function parseCsv(text: string): Record<string, string>[] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < src.length; i += 1) {
    const char = src[i]
    if (inQuotes) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"') {
      inQuotes = true
    } else if (char === ';') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (char !== '\r') {
      field += char
    }
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  const filtered = rows.filter((cells) => cells.some((cell) => cell.length > 0))
  if (!filtered.length) return []
  const headers = filtered[0]
  return filtered.slice(1).map((cells) => {
    const record: Record<string, string> = {}
    headers.forEach((header, index) => {
      record[header] = cells[index] ?? ''
    })
    return record
  })
}

function needsQuote(value: string): boolean {
  return /[";\n\r]/.test(value)
}

export function stringifyCsv(rows: Record<string, string>[], fields: string[], bom = false): string {
  const encode = (value: string) => {
    if (!needsQuote(value)) return value
    return `"${value.replaceAll('"', '""')}"`
  }
  const lines = [fields.join(';')]
  for (const row of rows) {
    lines.push(fields.map((field) => encode(row[field] ?? '')).join(';'))
  }
  const body = `${lines.join('\n')}\n`
  return bom ? `\uFEFF${body}` : body
}
