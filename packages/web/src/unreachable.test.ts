// @vitest-environment happy-dom
import { act, createElement, StrictMode, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './error-boundary.js'
import { UnreachableView } from './unreachable.js'

const fiMessage = 'Ajanotto-ohjelmaan ei saada yhteyttä. Paina Yritä uudelleen. Jos se ei auta, sulje ohjelma ja avaa se uudelleen. Jos ongelma jatkuu, ota yhteys seuran tekniseen tukeen.'
const enMessage = 'The timing program cannot be reached. Press Try again. If that does not help, close the program and open it again. If the problem continues, contact the club\'s technical support.'

function mount(node: ReactNode): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(node)
  })
  return { container, root }
}

function visibleText(html: string): string {
  const holder = document.createElement('div')
  holder.innerHTML = html
  return holder.textContent ?? ''
}

describe('UnreachableView', () => {
  it('renders the Finnish and English strings with the shared controls', () => {
    const finnish = renderToStaticMarkup(createElement(UnreachableView, { locale: 'fi', onRetry: () => undefined }))
    expect(visibleText(finnish)).toContain('Ei yhteyttä')
    expect(visibleText(finnish)).toContain(fiMessage)
    expect(visibleText(finnish)).toContain('Yritä uudelleen')
    expect(finnish).toContain('ui-banner-danger')
    expect(finnish).toContain('ui-button-primary')

    const english = renderToStaticMarkup(createElement(UnreachableView, { locale: 'en', onRetry: () => undefined }))
    const englishText = visibleText(english)
    expect(englishText).toContain('Cannot connect')
    expect(englishText).toContain(enMessage)
    expect(englishText).toContain('Try again')
    expect(englishText).not.toContain('Yritä uudelleen')
  })

  it('shows the connecting label and ignores another press', async () => {
    let release: () => void = () => undefined
    const attempt = new Promise<void>((resolve) => {
      release = resolve
    })
    let presses = 0
    const { container, root } = mount(createElement(UnreachableView, {
      locale: 'fi',
      onRetry: () => {
        presses += 1
        return attempt
      },
    }))
    const button = () => container.querySelector('[data-testid="unreachable-retry"]') as HTMLButtonElement
    expect(button().textContent).toBe('Yritä uudelleen')
    await act(async () => {
      button().click()
    })
    expect(presses).toBe(1)
    expect(button().textContent).toBe('Yhdistetään…')
    expect(button().disabled).toBe(true)
    expect(button().getAttribute('aria-busy')).toBe('true')
    await act(async () => {
      button().click()
    })
    expect(presses).toBe(1)
    await act(async () => {
      release()
    })
    expect(button().textContent).toBe('Yritä uudelleen')
    expect(button().disabled).toBe(false)
    expect(button().getAttribute('aria-busy')).not.toBe('true')
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('uses the English connecting label while the retry is in progress', async () => {
    let release: () => void = () => undefined
    const attempt = new Promise<void>((resolve) => {
      release = resolve
    })
    const { container, root } = mount(createElement(UnreachableView, {
      locale: 'en',
      onRetry: () => attempt,
    }))
    const button = container.querySelector('[data-testid="unreachable-retry"]') as HTMLButtonElement
    await act(async () => {
      button.click()
    })
    expect(button.textContent).toBe('Connecting…')
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('aria-busy')).toBe('true')
    await act(async () => {
      release()
    })
    expect(button.textContent).toBe('Try again')
    act(() => {
      root.unmount()
    })
    container.remove()
  })
})

describe('ErrorBoundary', () => {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    container?.remove()
    root = undefined
    container = undefined
    vi.restoreAllMocks()
  })

  it('catches a render error and shows the translated view in both languages', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    function Boom(): ReactNode {
      throw new Error('ties.filter failed')
    }
    ;({ container, root } = mount(createElement(
      StrictMode,
      null,
      createElement(ErrorBoundary, { locale: 'fi', onRetry: () => undefined, children: createElement(Boom) }),
    )))
    expect(container?.textContent).toContain(fiMessage)
    expect(container?.textContent).toContain('Yritä uudelleen')
    expect(console.error).toHaveBeenCalled()

    act(() => {
      root?.render(createElement(ErrorBoundary, { locale: 'en', onRetry: () => undefined, children: createElement(Boom) }))
    })
    expect(container?.textContent).toContain(enMessage)
    expect(container?.textContent).toContain('Try again')
  })

  it('reloads and shows the child again when Try again succeeds', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let broken = true
    function Maybe(): ReactNode {
      if (broken) throw new Error('render failed')
      return createElement('p', { 'data-testid': 'ready' }, 'ready')
    }
    ;({ container, root } = mount(createElement(ErrorBoundary, {
      locale: 'fi',
      onRetry: () => {
        broken = false
      },
      children: createElement(Maybe),
    })))
    expect(container?.textContent).toContain('Yritä uudelleen')
    const button = container?.querySelector('[data-testid="unreachable-retry"]')
    expect(button).toBeInstanceOf(HTMLButtonElement)
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container?.textContent).toContain('ready')
    expect(container?.querySelector('[data-testid="unreachable"]')).toBeNull()
  })
})
