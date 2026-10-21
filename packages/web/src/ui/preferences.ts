// SPDX-License-Identifier: AGPL-3.0-only
export type ThemeChoice = 'light' | 'dark' | 'system'
export type ColorScheme = 'light' | 'dark'
export type Guidance = 'guided' | 'expert'

/** Anything other than light or dark follows the operating system. */
export function parseThemeChoice(value: string | null | undefined): ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}

/** Guided is the default. Only an explicit expert value turns hints off. */
export function parseGuidance(value: string | null | undefined): Guidance {
  return value === 'expert' ? 'expert' : 'guided'
}

/** A light or dark choice overrides the system. System follows prefers-color-scheme. */
export function resolveColorScheme(choice: ThemeChoice, prefersDark: boolean): ColorScheme {
  if (choice === 'light' || choice === 'dark') return choice
  return prefersDark ? 'dark' : 'light'
}
