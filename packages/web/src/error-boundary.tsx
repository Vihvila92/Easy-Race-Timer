// SPDX-License-Identifier: AGPL-3.0-only
import type { Locale } from '@ert/i18n'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useApp } from './context.js'
import { UnreachableView } from './unreachable.js'

interface Props {
  locale: Locale
  onRetry: () => void | Promise<void>
  children: ReactNode
}

interface State {
  error: Error | null
}

/** Catches a render error and shows the same explanation as a failed load. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Race program is unreachable', error, info.componentStack)
  }

  private retry = (): Promise<void> => {
    return Promise.resolve(this.props.onRetry()).catch((caught: unknown) => {
      console.error('Race program is unreachable', caught)
    }).finally(() => {
      this.setState({ error: null })
    })
  }

  render(): ReactNode {
    if (this.state.error) return <UnreachableView locale={this.props.locale} onRetry={this.retry} />
    return this.props.children
  }
}

export function AppErrorBoundary({ children }: { children: ReactNode }) {
  const { locale, reload } = useApp()
  return (
    <ErrorBoundary locale={locale} onRetry={() => reload()}>
      {children}
    </ErrorBoundary>
  )
}
