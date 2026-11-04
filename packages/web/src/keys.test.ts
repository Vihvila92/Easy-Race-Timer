// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { en } from '@ert/i18n'

vi.mock('./context.js', () => ({
  useApp: () => ({
    t: (key: keyof typeof en) => en[key],
  }),
}))

const { RecoveryGuide, UnlockPanel } = await import('./keys.js')

function text(html: string): string {
  const holder = document.createElement('div')
  holder.innerHTML = html
  return holder.textContent ?? ''
}

const PAPER = 'Print it on paper. Do not save it as a PDF.'

describe('recovery guide', () => {
  it('tells the operator to print on paper and not to save a PDF', () => {
    const html = renderToStaticMarkup(createElement(RecoveryGuide))
    const body = text(html)
    expect(body).toContain(PAPER)
    expect(body).toContain(en['keys.guide.store'])
    expect(body).toContain(en['keys.guide.lost'])
    expect(body).toContain(en['keys.oldCopies'])
    expect(html).toContain('recovery-print')
    expect(body).not.toContain('XXXX-XXXX')
  })
})

describe('print view', () => {
  it('shows the recovery key only on the print view', () => {
    const secret = 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-CCCC'
    const printed = renderToStaticMarkup(createElement(UnlockPanel, { mode: 'print', recoveryKey: secret, notice: 'rotated' }))
    expect(text(printed)).toContain(secret)
    expect(text(printed)).toContain(en['keys.rotateLeftover'])
    const locked = renderToStaticMarkup(createElement(UnlockPanel, { mode: 'password', recoveryKey: secret, notice: 'failed' }))
    expect(text(locked)).not.toContain(secret)
    expect(locked).not.toContain('unlock-password')
    expect(locked).not.toContain('unlock-open')
    expect(locked).not.toContain('unlock-recovery')
    expect(text(locked)).toContain(en['unlock.failed'])
  })

  it('clears the printed key after printing and when the view unmounts', async () => {
    const secret = 'YYYY-YYYY-YYYY-YYYY-YYYY-YYYY-YYYY-YYYY-CCCC'
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(createElement(UnlockPanel, { mode: 'print', recoveryKey: secret }))
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

describe('unlock notices', () => {
  it('maps each notice to its sentence', () => {
    const notices = [
      ['wait', 'unlock.wait'],
      ['checksum', 'unlock.recoveryChecksum'],
      ['params', 'unlock.paramsRejected'],
      ['header', 'unlock.headerInvalid'],
      ['new-admin', 'unlock.newAdminPassword'],
      ['old-copies', 'keys.oldCopies'],
      ['single-admin', 'keys.singleAdmin'],
      ['temporary', 'keys.temporaryPassword'],
    ] as const
    for (const [notice, key] of notices) {
      const html = renderToStaticMarkup(createElement(UnlockPanel, { mode: 'password', notice }))
      expect(text(html)).toContain(en[key])
    }
  })
})
