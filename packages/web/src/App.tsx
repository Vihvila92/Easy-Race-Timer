// SPDX-License-Identifier: AGPL-3.0-only
import { lazy, Suspense, useEffect, useState } from 'react'
import { syncServerClock } from './api.js'
import { useApp } from './context.js'
import { flush } from './queue.js'
import { sourceCodeUrl } from './source-link.js'
import { Banner, TextLink } from './ui/components.js'
import { UnreachableView } from './unreachable.js'
import { Wizard } from './wizard.js'
import { About, Audit, Clubs, Corrections, Entries, Finish, ImportView, Office, PrintView, Results, Start, Ties } from './views.js'

const VIEWS = [
  ['/office', 'nav.office', Office],
  ['/import', 'nav.import', ImportView],
  ['/entries', 'nav.entries', Entries],
  ['/start', 'nav.start', Start],
  ['/finish', 'nav.finish', Finish],
  ['/corrections', 'nav.corrections', Corrections],
  ['/ties', 'nav.ties', Ties],
  ['/clubs', 'nav.clubs', Clubs],
  ['/results', 'nav.results', Results],
  ['/print', 'nav.print', PrintView],
  ['/audit', 'nav.audit', Audit],
  ['/about', 'nav.about', About],
] as const

/** Dev-only. The production build constant-folds this to null and drops the page. */
const PreviewPage = import.meta.env.DEV
  ? lazy(() => import('./preview.js').then((module) => ({ default: module.PreviewPage })))
  : null

function Preferences() {
  const { t, theme, setTheme, locale, setLocale, guidance, setGuidance } = useApp()
  return (
    <div className="stack settings" data-testid="settings">
      <span className="muted settings-label">{t('settings.title')}</span>
      <div className="segment" role="group" aria-label={t('a11y.language')}>
        <button type="button" className={locale === 'fi' ? '' : 'secondary'} data-testid="lang-fi" onClick={() => setLocale('fi')}>{t('lang.fi')}</button>
        <button type="button" className={locale === 'en' ? '' : 'secondary'} data-testid="lang-en" onClick={() => setLocale('en')}>{t('lang.en')}</button>
      </div>
      <div className="segment" role="group" aria-label={t('a11y.guidance')}>
        <button type="button" className={guidance === 'guided' ? '' : 'secondary'} aria-pressed={guidance === 'guided'} data-testid="guidance-guided" onClick={() => setGuidance('guided')}>{t('settings.guided')}</button>
        <button type="button" className={guidance === 'expert' ? '' : 'secondary'} aria-pressed={guidance === 'expert'} data-testid="guidance-expert" onClick={() => setGuidance('expert')}>{t('settings.expert')}</button>
      </div>
      <div className="segment" role="group" aria-label={t('a11y.theme')}>
        <button type="button" className={theme === 'light' ? '' : 'secondary'} aria-pressed={theme === 'light'} data-testid="theme-light" onClick={() => setTheme('light')}>{t('theme.light')}</button>
        <button type="button" className={theme === 'dark' ? '' : 'secondary'} aria-pressed={theme === 'dark'} data-testid="theme-dark" onClick={() => setTheme('dark')}>{t('theme.dark')}</button>
        <button type="button" className={theme === 'system' ? '' : 'secondary'} aria-pressed={theme === 'system'} data-testid="theme-system" onClick={() => setTheme('system')}>{t('theme.system')}</button>
      </div>
    </div>
  )
}

/** AGPL source link. It stays outside the view so the PIN gate and a later race mode still show it. */
function SourceFooter() {
  const { t } = useApp()
  return (
    <p className="footer">
      <TextLink href={sourceCodeUrl(__ERT_SOURCE_REF__)} rel="noreferrer" testId="source-link">{t('common.source')}</TextLink>
    </p>
  )
}

function PinGate() {
  const { t, error, login } = useApp()
  const [pin, setPin] = useState('')
  return (
    <div className="shell wizard-shell">
      <main className="main">
        <section data-testid="pin-gate">
          <h1>{t('pin.title')}</h1>
          <p className="lead">{t('pin.lead')}</p>
          {error && <p className="error" role="alert" data-testid="form-error">{t('common.error')}: {error}</p>}
          <input aria-label={t('office.pin')} data-testid="pin-input" inputMode="numeric" value={pin} onChange={(event) => setPin(event.target.value)} />
          <button type="button" data-testid="pin-submit" onClick={() => { void login(pin) }}>{t('pin.open')}</button>
        </section>
        <SourceFooter />
      </main>
    </div>
  )
}

function useHash(): string {
  const [hash, setHash] = useState(() => window.location.hash.replace('#', '') || '/office')
  useEffect(() => {
    const onHash = () => setHash(window.location.hash.replace('#', '') || '/office')
    window.addEventListener('hashchange', onHash)
    flush().catch(() => undefined)
    const measure = () => { void syncServerClock() }
    measure()
    window.addEventListener('online', measure)
    const timer = window.setInterval(measure, 30_000)
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('online', measure)
      window.clearInterval(timer)
    }
  }, [])
  return hash
}

function ConnectionStatus() {
  const { connection, t } = useApp()
  return (
    <div role="status" aria-live="polite" aria-atomic="true" data-testid="connection-status">
      {connection === 'reconnecting' ? <Banner tone="info">{t('connection.reconnecting')}</Banner> : null}
    </div>
  )
}

function Startup() {
  const { t, locale, unreachable, reload } = useApp()
  if (unreachable) return <UnreachableView locale={locale} onRetry={() => reload().catch(() => undefined)} />
  return <div className="shell wizard-shell"><main className="main"><p>{t('common.loading')}</p><SourceFooter /></main></div>
}

type ViewEntry = (typeof VIEWS)[number]

function navLinks(data: { event?: unknown } | null, settingUp: boolean): readonly ViewEntry[] {
  if (!data || settingUp) return VIEWS.filter(([path]) => Boolean(data) && (path === '/import' || path === '/about'))
  return VIEWS
}

function AppNav({ links, current, waiting, showWizard, preview }: {
  links: readonly ViewEntry[]
  current: string
  waiting: number
  showWizard: boolean
  preview: boolean
}) {
  const { t } = useApp()
  return (
    <nav className="nav" aria-label={t('a11y.menu')}>
      <div className="brand">
        <strong>{t('app.name')}</strong>
        <span>{t('app.tagline')}</span>
      </div>
      {links.map(([path, key]) => (
        <a key={path} className="nav-link" href={`#${path}`} data-testid={`nav-${path.slice(1)}`} aria-current={!showWizard && !preview && current === path ? 'page' : undefined}>
          <span>{t(key)}</span>
          {path === '/ties' && waiting > 0 ? <span className="badge" data-testid="tie-badge">{waiting}</span> : null}
        </a>
      ))}
      {import.meta.env.DEV ? (
        <a className="nav-link" href="#/preview" data-testid="nav-preview" aria-current={preview ? 'page' : undefined}>{t('preview.title')}</a>
      ) : null}
      <Preferences />
    </nav>
  )
}

function AppMain({ preview, showWizard, View }: { preview: boolean; showWizard: boolean; View: ViewEntry[2] }) {
  const { t, error } = useApp()
  const page = preview && PreviewPage
    ? <Suspense fallback={<p>{t('common.loading')}</p>}><PreviewPage /></Suspense>
    : showWizard ? <Wizard /> : <View />
  return (
    <main className="main">
      <ConnectionStatus />
      {error ? <p className="error" role="alert" data-testid="form-error">{t('common.error')}: {error}</p> : null}
      {page}
      <SourceFooter />
    </main>
  )
}

function wantsWizard(preview: boolean, settingUp: boolean, hash: string, hasData: boolean): boolean {
  if (preview || !settingUp || !hasData) return false
  return hash !== '/import' && hash !== '/about'
}

function RaceShell({ hash, preview }: { hash: string; preview: boolean }) {
  const { data } = useApp()
  const current = VIEWS.find(([path]) => path === hash) ?? VIEWS[0]
  const waiting = data?.ties?.filter((group) => group.status === 'unconfirmed').length ?? 0
  const settingUp = !data?.event
  const showWizard = wantsWizard(preview, settingUp, hash, !!data)
  return (
    <div className={showWizard ? 'shell wizard-shell' : 'shell'}>
      <AppNav links={navLinks(data, settingUp)} current={current[0]} waiting={waiting} showWizard={showWizard} preview={preview} />
      <AppMain preview={preview} showWizard={showWizard} View={current[2]} />
    </div>
  )
}

export function App() {
  const { needsPin, data } = useApp()
  const hash = useHash()
  if (needsPin) return <PinGate />
  const preview = import.meta.env.DEV && hash === '/preview' && PreviewPage != null
  if (!data && !preview) return <Startup />
  return <RaceShell hash={hash} preview={preview} />
}
