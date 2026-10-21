import { translate, type Locale } from '@ert/i18n'
import { Banner, Button } from './ui/components.js'

/** Explains that the timing program cannot be reached. Strings come from the catalogs. */
export function UnreachableView({ locale, onRetry }: { locale: Locale; onRetry: () => void }) {
  return (
    <div className="shell wizard-shell">
      <main className="main">
        <section className="ui-section" data-testid="unreachable" aria-labelledby="unreachable-title">
          <h1 id="unreachable-title">{translate(locale, 'unreachable.title')}</h1>
          <Banner tone="danger" role="alert" testId="unreachable-message">
            {translate(locale, 'unreachable.message')}
          </Banner>
          <div className="ui-actions">
            <Button variant="primary" data-testid="unreachable-retry" onClick={onRetry}>
              {translate(locale, 'unreachable.retry')}
            </Button>
          </div>
        </section>
      </main>
    </div>
  )
}
