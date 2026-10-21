import { describe, expect, it } from 'vitest'
import { unreachableDetail, validateWorkspaceResponse } from './workspace.js'

const valid = {
  ties: [],
  races: [],
  entries: [],
}

describe('validateWorkspaceResponse', () => {
  it('accepts a workspace whose ties field is an array', () => {
    const result = validateWorkspaceResponse(valid)
    expect(result).toEqual({ ok: true, workspace: valid })
    const withGroups = { ties: [{ status: 'unconfirmed', members: [] }] }
    const grouped = validateWorkspaceResponse(withGroups)
    expect(grouped.ok).toBe(true)
    if (grouped.ok) expect(grouped.workspace).toBe(withGroups)
  })

  it('rejects a body that is missing ties', () => {
    expect(validateWorkspaceResponse({})).toEqual({ ok: false, reason: 'unreachable' })
    expect(validateWorkspaceResponse({ races: [], entries: [] })).toEqual({ ok: false, reason: 'unreachable' })
    expect(validateWorkspaceResponse({ ties: undefined })).toEqual({ ok: false, reason: 'unreachable' })
  })

  it('rejects a body whose ties field is not an array', () => {
    expect(validateWorkspaceResponse({ ties: null })).toEqual({ ok: false, reason: 'unreachable' })
    expect(validateWorkspaceResponse({ ties: { status: 'unconfirmed' } })).toEqual({ ok: false, reason: 'unreachable' })
    expect(validateWorkspaceResponse({ ties: 'none' })).toEqual({ ok: false, reason: 'unreachable' })
  })

  it('rejects an HTML string', () => {
    const html = '<!doctype html><html><body>not the program</body></html>'
    expect(validateWorkspaceResponse(html)).toEqual({ ok: false, reason: 'unreachable' })
    expect(() => validateWorkspaceResponse(html)).not.toThrow()
  })

  it('rejects a network error', () => {
    const error = new TypeError('Failed to fetch')
    expect(validateWorkspaceResponse(error)).toEqual({ ok: false, reason: 'unreachable' })
    expect(validateWorkspaceResponse(new Error('network down'))).toEqual({ ok: false, reason: 'unreachable' })
    expect(() => validateWorkspaceResponse(error)).not.toThrow()
  })

  it('keeps technical detail short', () => {
    expect(unreachableDetail(new TypeError('Failed to fetch'))).toBe('Failed to fetch')
    expect(unreachableDetail({ races: [] })).toBe('ties is undefined')
    expect(unreachableDetail({ ties: {} })).toBe('ties is object')
    const html = `<html>${'x'.repeat(400)}</html>`
    const detail = unreachableDetail(html)
    expect(detail.startsWith('text (')).toBe(true)
    expect(detail.length).toBeLessThan(html.length)
  })
})
