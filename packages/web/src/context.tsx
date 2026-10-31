// SPDX-License-Identifier: AGPL-3.0-only
import { parseLocale, translate, type Locale, type MessageKey } from '@ert/i18n'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError, api, loadWorkspace } from './api.js'
import { LiveSession, openLiveSocket, type LiveConnection } from './live-session.js'
import type { Workspace } from './types.js'
import { parseGuidance, parseThemeChoice, resolveColorScheme, type Guidance, type ThemeChoice } from './ui/preferences.js'
import { unreachableDetail, validateWorkspaceResponse } from './workspace.js'

export type Theme = ThemeChoice
export type { Guidance }

interface AppContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  guidance: Guidance
  setGuidance: (guidance: Guidance) => void
  theme: Theme
  setTheme: (theme: Theme) => void
  t: (key: MessageKey, vars?: Record<string, string | number>) => string
  data: Workspace | null
  needsPin: boolean
  unreachable: boolean
  /** `reconnecting` while a dropped live socket is retrying. `connected` hides the notice. */
  connection: LiveConnection
  reload: () => Promise<void>
  login: (pin: string) => Promise<void>
  error: string
  clearError: () => void
  run: <T>(fn: () => Promise<T>) => Promise<T>
}

const AppContext = createContext<AppContextValue | null>(null)

function storedLocale(): Locale {
  const raw = localStorage.getItem('ert-locale')
  const locale = parseLocale(raw)
  if (raw !== null && raw !== locale) localStorage.setItem('ert-locale', locale)
  return locale
}

function storedGuidance(): Guidance {
  return parseGuidance(localStorage.getItem('ert-guidance'))
}

function storedTheme(): Theme {
  return parseThemeChoice(localStorage.getItem('ert-theme'))
}

function healthHasPin(health: unknown): boolean {
  if (typeof health !== 'object' || health === null || !('pinConfigured' in health)) return false
  return Boolean((health as { pinConfigured?: unknown }).pinConfigured)
}

interface RaceControls {
  dataRef: { current: Workspace | null }
  setData: (data: Workspace | null) => void
  setNeedsPin: (value: boolean) => void
  setUnreachable: (value: boolean) => void
  setAuthenticated: (value: boolean) => void
}

function useDocumentTheme(theme: Theme, locale: Locale): void {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => applyDocumentTheme(theme, locale, media.matches)
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme, locale])
}

function applyDocumentTheme(theme: Theme, locale: Locale, systemDark: boolean): void {
  const resolved = resolveColorScheme(theme, systemDark)
  document.documentElement.dataset.theme = resolved
  document.documentElement.lang = locale
  document.documentElement.style.colorScheme = resolved
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#000000' : '#f2f2f7')
}

function usePreferences() {
  const [locale, setLocaleState] = useState<Locale>(storedLocale)
  const [guidance, setGuidanceState] = useState<Guidance>(storedGuidance)
  const [theme, setThemeState] = useState<Theme>(storedTheme)
  const setLocale = useCallback((next: Locale) => {
    const parsed = parseLocale(next)
    localStorage.setItem('ert-locale', parsed)
    setLocaleState(parsed)
  }, [])
  const setGuidance = useCallback((next: Guidance) => {
    const parsed = next === 'expert' ? 'expert' : 'guided'
    localStorage.setItem('ert-guidance', parsed)
    setGuidanceState(parsed)
  }, [])
  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem('ert-theme', next)
    setThemeState(next)
  }, [])
  useDocumentTheme(theme, locale)
  return useMemo(() => ({ locale, setLocale, guidance, setGuidance, theme, setTheme }), [locale, setLocale, guidance, setGuidance, theme, setTheme])
}

function applyPinRequired(state: RaceControls): void {
  state.dataRef.current = null
  state.setData(null)
  state.setNeedsPin(true)
  state.setUnreachable(false)
  state.setAuthenticated(false)
}

async function loadSignedIn(state: RaceControls): Promise<void> {
  const health: unknown = await api('/api/v1/health')
  if (!healthHasPin(health)) await api('/api/v1/settings/pin/check', { method: 'POST', body: '{}' })
  const body: unknown = await loadWorkspace()
  const result = validateWorkspaceResponse(body)
  if (!result.ok) throw new ApiError('VALIDATION_ERROR', unreachableDetail(body))
  state.dataRef.current = result.workspace
  state.setData(result.workspace)
  state.setNeedsPin(false)
  state.setUnreachable(false)
  state.setAuthenticated(true)
}

function noteUnreachable(state: RaceControls, caught: unknown): void {
  console.error('Race program is unreachable', caught instanceof Error ? caught : unreachableDetail(caught))
  const failure = validateWorkspaceResponse(caught)
  if (!failure.ok && state.dataRef.current == null) {
    state.setUnreachable(true)
    state.setAuthenticated(false)
    return
  }
  throw caught
}

function useRaceState() {
  const dataRef = useRef<Workspace | null>(null)
  const [data, setData] = useState<Workspace | null>(null)
  const [needsPin, setNeedsPin] = useState(false)
  const [unreachable, setUnreachable] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [error, setError] = useState('')
  const controls = useRef<RaceControls>({ dataRef, setData, setNeedsPin, setUnreachable, setAuthenticated })
  const reload = useCallback(async () => {
    try {
      await loadSignedIn(controls.current)
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'PIN_REQUIRED') {
        applyPinRequired(controls.current)
        return
      }
      noteUnreachable(controls.current, caught)
    }
  }, [])
  useEffect(() => { reload().catch(() => undefined) }, [reload])
  const clearError = useCallback(() => setError(''), [])
  return useMemo(() => ({
    data, dataRef, needsPin, unreachable, authenticated, error, setError, setNeedsPin, setAuthenticated, reload, clearError, controls,
  }), [data, needsPin, unreachable, authenticated, error, reload, clearError])
}

function queueResync(reload: () => Promise<void>): { run: () => void; cancel: () => void } {
  let cancelled = false
  let running = false
  let again = false
  const run = () => {
    if (cancelled) return
    if (running) {
      again = true
      return
    }
    running = true
    void reload().catch(() => undefined).finally(() => {
      running = false
      if (cancelled || !again) return
      again = false
      run()
    })
  }
  return { run, cancel: () => { cancelled = true } }
}

function useLiveSocket(authenticated: boolean, reload: () => Promise<void>, controls: { current: RaceControls }): LiveConnection {
  const [connection, setConnection] = useState<LiveConnection>('connected')
  const sessionRef = useRef<LiveSession | null>(null)
  useEffect(() => {
    if (!authenticated) {
      sessionRef.current?.stop()
      sessionRef.current = null
      setConnection('connected')
      return
    }
    const resync = queueResync(reload)
    const session = new LiveSession({
      open: openLiveSocket,
      onExpired: () => {
        applyPinRequired(controls.current)
        setConnection('connected')
      },
      onStatus: (status) => setConnection(status),
      onResync: resync.run,
    })
    sessionRef.current = session
    session.start()
    return () => {
      resync.cancel()
      session.stop()
      if (sessionRef.current === session) sessionRef.current = null
    }
  }, [authenticated, reload, controls])
  return connection
}

function useLogin(reload: () => Promise<void>, setError: (value: string) => void, setNeedsPin: (value: boolean) => void, setAuthenticated: (value: boolean) => void) {
  return useCallback(async (pin: string) => {
    setError('')
    try {
      await api('/api/v1/settings/pin/check', { method: 'POST', body: JSON.stringify({ pin }) })
      await reload()
    } catch (caught) {
      setNeedsPin(true)
      setAuthenticated(false)
      setError(caught instanceof ApiError ? caught.code : 'VALIDATION_ERROR')
    }
  }, [reload, setError, setNeedsPin, setAuthenticated])
}

function useRun(reload: () => Promise<void>, setError: (value: string) => void) {
  return useCallback(async <T,>(fn: () => Promise<T>) => {
    setError('')
    try {
      const value = await fn()
      await reload()
      return value
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.code : 'VALIDATION_ERROR')
      throw caught
    }
  }, [reload, setError])
}

function contextValue(input: {
  prefs: ReturnType<typeof usePreferences>
  race: ReturnType<typeof useRaceState>
  connection: LiveConnection
  login: (pin: string) => Promise<void>
  run: <T>(fn: () => Promise<T>) => Promise<T>
}): AppContextValue {
  const { prefs, race, connection, login, run } = input
  return {
    ...prefs,
    t: (key, vars) => translate(prefs.locale, key, vars),
    data: race.data,
    needsPin: race.needsPin,
    unreachable: race.unreachable,
    connection,
    reload: race.reload,
    login,
    error: race.error,
    clearError: race.clearError,
    run,
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const prefs = usePreferences()
  const race = useRaceState()
  const login = useLogin(race.reload, race.setError, race.setNeedsPin, race.setAuthenticated)
  const connection = useLiveSocket(race.authenticated, race.reload, race.controls)
  const run = useRun(race.reload, race.setError)
  const value = useMemo(() => contextValue({ prefs, race, connection, login, run }), [prefs, race, connection, login, run])
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp outside provider')
  return value
}
