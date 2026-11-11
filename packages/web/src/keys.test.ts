// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { en } from '@ert/i18n'

const guidance = { current: 'guided' as 'guided' | 'expert' }

vi.mock('./context.js', () => ({
  useApp: () => ({
    t: (key: keyof typeof en, vars?: Record<string, string | number>) => {
      const text = en[key]
      if (!vars) return text
      return text.replace(/\{(\w+)\}/g, (_match, name: string) => String(vars[name] ?? ''))
    },
    guidance: guidance.current,
  }),
}))

vi.mock('./key-client.js', () => ({
  acknowledgeKey: vi.fn(async () => ({ state: 'admin' })),
  keyFailure: () => ({ key: 'unlock.failed' }),
  unlockWithAdminPassword: vi.fn(),
  unlockWithPaper: vi.fn(),
  changeKeyPassword: vi.fn(),
}))

const { RecoveryGuide, RecoveryPrint } = await import('./recovery-view.js')
const { UnlockForm } = await import('./unlock-view.js')

function text(html: string): string {
  const holder = document.createElement('div')
  holder.innerHTML = html
  return holder.textContent ?? ''
}

const PAPER = 'Print it on paper. Do not save it as a PDF.'

describe('recovery guide', () => {
  it('shows the unrecoverable-data warning and the paper instruction', () => {
    const html = renderToStaticMarkup(createElement(RecoveryGuide))
    const body = text(html)
    expect(body).toContain(PAPER)
    expect(body).toContain(en['unlock.unrecoverable'])
    expect(body).toContain(en['keys.guide.store'])
    expect(body).toContain(en['keys.pairFiles'])
    expect(body).not.toContain('XXXX-XXXX')
  })
})

describe('print view', () => {
  it('shows the recovery key only on the print view and clears it after printing', async () => {
    const secret = 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-CCCC'
    const printed = renderToStaticMarkup(createElement(RecoveryPrint, {
      recoveryKey: secret,
      generation: 1,
      onClear: () => undefined,
      onAcknowledged: () => undefined,
    }))
    expect(text(printed)).toContain(secret)
    expect(text(printed)).toContain(PAPER)
    expect(text(printed)).toContain(en['unlock.unrecoverable'])
    const locked = renderToStaticMarkup(createElement(UnlockForm, { onUnlocked: () => undefined }))
    expect(text(locked)).not.toContain(secret)
    expect(text(locked)).toContain(en['unlock.password'])
    expect(locked).toContain('type="password"')

    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(createElement(RecoveryPrint, {
        recoveryKey: secret,
        generation: 1,
        onClear: () => undefined,
        onAcknowledged: () => undefined,
      }))
    })
    expect(host.textContent).toContain(secret)
    await act(async () => {
      window.dispatchEvent(new Event('afterprint'))
    })
    expect(host.textContent).not.toContain(secret)
    await act(async () => {
      root.unmount()
    })
    expect(host.textContent).not.toContain(secret)
    host.remove()
  })
})
