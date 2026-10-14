import { useEffect, useState } from 'react'
import { useApp } from './context.js'
import { flush } from './queue.js'
import { Wizard } from './wizard.js'
import { Audit, Clubs, Corrections, Entries, Finish, ImportView, Office, PrintView, Results, Start, Ties } from './views.js'

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
] as const

function Preferences() {
  const { t, theme, setTheme, locale, setLocale } = useApp()
  return (
    <>
      <div className="segment" role="group" aria-label={t('a11y.language')}>
        <button type="button" className={locale === 'fi' ? '' : 'secondary'} data-testid="lang-fi" onClick={() => setLocale('fi')}>{t('lang.fi')}</button>
        <button type="button" className={locale === 'en' ? '' : 'secondary'} data-testid="lang-en" onClick={() => setLocale('en')}>{t('lang.en')}</button>
      </div>
      <div className="segment" role="group" aria-label={t('a11y.theme')}>
        <button type="button" className="secondary" data-testid="theme-light" onClick={() => setTheme('light')}>{t('theme.light')}</button>
        <button type="button" className="secondary" data-testid="theme-dark" onClick={() => setTheme('dark')}>{t('theme.dark')}</button>
        <button type="button" className="secondary" data-testid="theme-system" onClick={() => setTheme('system')}>{t('theme.system')}</button>
      </div>
      <p className="muted" data-testid="theme-value">{theme}</p>
    </>
  )
}

export function App() {
  const { t, data, error } = useApp()
  const [hash, setHash] = useState(() => window.location.hash.replace('#', '') || '/office')
  useEffect(() => {
    const onHash = () => setHash(window.location.hash.replace('#', '') || '/office')
    window.addEventListener('hashchange', onHash)
    flush().catch(() => undefined)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const current = VIEWS.find(([path]) => path === hash) ?? VIEWS[0]
  const View = current[2]
  const waiting = data?.ties.filter((group) => group.status === 'unconfirmed').length ?? 0
  if (!data) {
    return <div className="shell wizard-shell"><main className="main"><p>{t('common.loading')}</p></main></div>
  }
  const settingUp = !data.event
  const links = settingUp ? VIEWS.filter(([path]) => path === '/import') : VIEWS
  const showWizard = settingUp && hash !== '/import'
  return (
    <div className={showWizard ? 'shell wizard-shell' : 'shell'}>
      <nav className="nav" aria-label={t('a11y.menu')}>
        <div className="brand">
          <strong>{t('app.name')}</strong>
          <span>{t('app.tagline')}</span>
        </div>
        {links.map(([path, key]) => (
          <a key={path} className="nav-link" href={`#${path}`} data-testid={`nav-${path.slice(1)}`} aria-current={!showWizard && current[0] === path ? 'page' : undefined}>
            <span>{t(key)}</span>
            {path === '/ties' && waiting > 0 && <span className="badge" data-testid="tie-badge">{waiting}</span>}
          </a>
        ))}
        <Preferences />
      </nav>
      <main className="main">
        {error && <p className="error" role="alert" data-testid="form-error">{t('common.error')}: {error}</p>}
        {showWizard ? <Wizard /> : <View />}
        <p className="footer"><a href="https://github.com/Vihvila92/Easy-Race-Timer">{t('common.source')}</a></p>
      </main>
    </div>
  )
}
