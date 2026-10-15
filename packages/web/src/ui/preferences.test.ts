import { describe, expect, it } from 'vitest'
import { parseGuidance, parseThemeChoice, resolveColorScheme } from './preferences.js'

describe('appearance preferences', () => {
  it('follows the system until the user picks light or dark', () => {
    expect(parseThemeChoice(null)).toBe('system')
    expect(parseThemeChoice('nope')).toBe('system')
    expect(parseThemeChoice('light')).toBe('light')
    expect(resolveColorScheme('system', true)).toBe('dark')
    expect(resolveColorScheme('system', false)).toBe('light')
    expect(resolveColorScheme('light', true)).toBe('light')
    expect(resolveColorScheme('dark', false)).toBe('dark')
  })

  it('keeps guided mode as the default', () => {
    expect(parseGuidance(null)).toBe('guided')
    expect(parseGuidance('guided')).toBe('guided')
    expect(parseGuidance('expert')).toBe('expert')
    expect(parseGuidance('off')).toBe('guided')
  })
})
