import { translate, type Locale, type MessageKey } from '@ert/i18n'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError, api, loadWorkspace } from './api.js'
import type { Workspace } from './types.js'

export type Theme = 'light' | 'dark' | 'system'

interface AppContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  theme: Theme
  setTheme: (theme: Theme) => void
  t: (key: MessageKey, vars?: Record<string, string | number>) => string
  data: Workspace | null
  needsPin: boolean
  reload: () => Promise<void>
  login: (pin: string) => Promise<void>
  error: string
  clearError: () => void
  run: <T>(fn: () => Promise<T>) => Promise<T>
}

const AppContext = createContext<AppContextValue | null>(null)

function storedTheme(): Theme {
  const value = localStorage.getItem('ert-theme')
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}

function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => (localStorage.getItem('ert-locale') === 'en' ? 'en' : 'fi'))
  const [theme, setThemeState] = useState<Theme>(storedTheme)
  const [data, setData] = useState<Workspace | null>(null)
  const [needsPin, setNeedsPin] = useState(false)
  const [error, setError] = useState('')

  const setLocale = useCallback((next: Locale) => {
    localStorage.setItem('ert-locale', next)
    setLocaleState(next)
  }, [])

  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem('ert-theme', next)
    setThemeState(next)
  }, [])

  useEffect(() => {
    const resolved = resolveTheme(theme)
    document.documentElement.dataset.theme = resolved
    document.documentElement.lang = locale
    document.documentElement.style.colorScheme = resolved
    const themeColor = document.querySelector('meta[name="theme-color"]')
    themeColor?.setAttribute('content', resolved === 'dark' ? '#000000' : '#f2f2f7')
  }, [theme, locale])

  const reload = useCallback(async () => {
    const health = await api<{ pinConfigured: boolean }>('/api/v1/health')
    if (!health.pinConfigured) {
      await api('/api/v1/settings/pin/check', { method: 'POST', body: '{}' })
    }
    try {
      setData(await loadWorkspace())
      setNeedsPin(false)
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'PIN_REQUIRED') {
        setData(null)
        setNeedsPin(true)
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
      setError(caught instanceof ApiError ? caught.code : 'VALIDATION_ERROR')
    }
  }, [reload])

  useEffect(() => {
    reload().catch(() => setError('VALIDATION_ERROR'))
  }, [reload])

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
    theme,
    setTheme,
    t: (key, vars) => translate(locale, key, vars),
    data,
    needsPin,
    reload,
    login,
    error,
    clearError: () => setError(''),
    run,
  }), [locale, setLocale, theme, setTheme, data, needsPin, reload, login, error, run])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp outside provider')
  return value
}
