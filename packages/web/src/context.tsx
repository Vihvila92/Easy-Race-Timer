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

export function AppProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(storedLocale)
  const [guidance, setGuidanceState] = useState<Guidance>(storedGuidance)
  const [theme, setThemeState] = useState<Theme>(storedTheme)
  const [data, setData] = useState<Workspace | null>(null)
  const dataRef = useRef<Workspace | null>(null)
  const [needsPin, setNeedsPin] = useState(false)
  const [unreachable, setUnreachable] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [error, setError] = useState('')
  const [connection, setConnection] = useState<LiveConnection>('connected')
  const sessionRef = useRef<LiveSession | null>(null)

  const setLocale = useCallback((next: Locale) => {
    const locale = parseLocale(next)
    localStorage.setItem('ert-locale', locale)
    setLocaleState(locale)
  }, [])

  const setGuidance = useCallback((next: Guidance) => {
    const guidance = next === 'expert' ? 'expert' : 'guided'
    localStorage.setItem('ert-guidance', guidance)
    setGuidanceState(guidance)
  }, [])

  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem('ert-theme', next)
    setThemeState(next)
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const resolved = resolveColorScheme(theme, media.matches)
      document.documentElement.dataset.theme = resolved
      document.documentElement.lang = locale
      document.documentElement.style.colorScheme = resolved
      const themeColor = document.querySelector('meta[name="theme-color"]')
      themeColor?.setAttribute('content', resolved === 'dark' ? '#000000' : '#f2f2f7')
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme, locale])

  const reload = useCallback(async () => {
    try {
      const health: unknown = await api('/api/v1/health')
      if (!healthHasPin(health)) {
        await api('/api/v1/settings/pin/check', { method: 'POST', body: '{}' })
      }
      const body: unknown = await loadWorkspace()
      const result = validateWorkspaceResponse(body)
      if (!result.ok) throw new ApiError('VALIDATION_ERROR', unreachableDetail(body))
      dataRef.current = result.workspace
      setData(result.workspace)
      setNeedsPin(false)
      setUnreachable(false)
      setAuthenticated(true)
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'PIN_REQUIRED') {
        dataRef.current = null
        setData(null)
        setNeedsPin(true)
        setUnreachable(false)
        setAuthenticated(false)
        return
      }
      console.error('Race program is unreachable', caught instanceof Error ? caught : unreachableDetail(caught))
      const failure = validateWorkspaceResponse(caught)
      if (!failure.ok && dataRef.current == null) {
        setUnreachable(true)
        setAuthenticated(false)
        return
      }
      throw caught
    }
  }, [])

  const login = useCallback(async (pin: string) => {
    setError('')
    try {
      await api('/api/v1/settings/pin/check', { method: 'POST', body: JSON.stringify({ pin }) })
      await reload()
    } catch (caught) {
      setNeedsPin(true)
      setAuthenticated(false)
      setError(caught instanceof ApiError ? caught.code : 'VALIDATION_ERROR')
    }
  }, [reload])

  useEffect(() => {
    reload().catch(() => undefined)
  }, [reload])

  useEffect(() => {
    if (!authenticated) {
      sessionRef.current?.stop()
      sessionRef.current = null
      setConnection('connected')
      return
    }
    let cancelled = false
    let running = false
    let again = false
    const resync = () => {
      if (cancelled) return
      if (running) {
        again = true
        return
      }
      running = true
      void reload()
        .catch(() => undefined)
        .finally(() => {
          running = false
          if (cancelled || !again) return
          again = false
          resync()
        })
    }
    const session = new LiveSession({
      open: openLiveSocket,
      onExpired: () => {
        dataRef.current = null
        setData(null)
        setNeedsPin(true)
        setUnreachable(false)
        setAuthenticated(false)
        setConnection('connected')
      },
      onStatus: (status) => {
        if (!cancelled) setConnection(status)
      },
      onResync: resync,
    })
    sessionRef.current = session
    session.start()
    return () => {
      cancelled = true
      session.stop()
      if (sessionRef.current === session) sessionRef.current = null
    }
  }, [authenticated, reload])

  const run = useCallback(async <T,>(fn: () => Promise<T>) => {
    setError('')
    try {
      const value = await fn()
      await reload()
      return value
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.code : 'VALIDATION_ERROR')
      throw caught
    }
  }, [reload])

  const value = useMemo<AppContextValue>(() => ({
    locale,
    setLocale,
    guidance,
    setGuidance,
    theme,
    setTheme,
    t: (key, vars) => translate(locale, key, vars),
    data,
    needsPin,
    unreachable,
    connection,
    reload,
    login,
    error,
    clearError: () => setError(''),
    run,
  }), [locale, setLocale, guidance, setGuidance, theme, setTheme, data, needsPin, unreachable, connection, reload, login, error, run])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp outside provider')
  return value
}
