import { translate, type Locale } from '@ert/i18n'
import { useEffect, useRef, useState } from 'react'
import { Banner, Button } from './ui/components.js'

/** Explains that the timing program cannot be reached. Strings come from the catalogs. */
export function UnreachableView({ locale, onRetry }: { locale: Locale; onRetry: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  async function retry() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await onRetry()
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }

  return (
    <div className="shell wizard-shell">
      <main className="main">
        <section className="ui-section" data-testid="unreachable" aria-labelledby="unreachable-title">
          <h1 id="unreachable-title">{translate(locale, 'unreachable.title')}</h1>
          <Banner tone="danger" role="alert" testId="unreachable-message">
            {translate(locale, 'unreachable.message')}
          </Banner>
          <div className="ui-actions">
            <Button
              variant="primary"
              data-testid="unreachable-retry"
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={() => { void retry() }}
            >
              {translate(locale, busy ? 'unreachable.connecting' : 'unreachable.retry')}
            </Button>
          </div>
        </section>
      </main>
    </div>
  )
}
