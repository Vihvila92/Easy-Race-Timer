// SPDX-License-Identifier: AGPL-3.0-only
import type { Workspace } from './types.js'

export type WorkspaceResponse =
  | { ok: true; workspace: Workspace }
  | { ok: false; reason: 'unreachable' }

function hasTiesArray(value: object): value is Workspace {
  return Array.isArray((value as { ties?: unknown }).ties)
}

/**
 * A bootstrap body is usable only when `ties` is an array.
 * A thrown network error, an HTML document, and any other shape mean the race program cannot be reached.
 */
export function validateWorkspaceResponse(input: unknown): WorkspaceResponse {
  if (input instanceof Error) return { ok: false, reason: 'unreachable' }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, reason: 'unreachable' }
  if (!hasTiesArray(input)) return { ok: false, reason: 'unreachable' }
  return { ok: true, workspace: input }
}

/** Technical detail for the console. User-facing copy stays in the catalogs. */
export function unreachableDetail(input: unknown): string {
  if (input instanceof Error) return input.message || input.name
  if (typeof input === 'string') {
    const compact = input.replace(/\s+/g, ' ').slice(0, 120)
    return `text (${input.length}): ${compact}`
  }
  if (typeof input === 'object' && input !== null) {
    const ties = (input as { ties?: unknown }).ties
    const kind = Array.isArray(ties) ? 'array' : ties === null ? 'null' : typeof ties
    return `ties is ${kind}`
  }
  return input === undefined ? 'undefined' : String(input)
}
