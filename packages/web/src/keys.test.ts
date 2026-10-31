// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { en } from '@ert/i18n'

const guidance = { current: 'guided' as 'guided' | 'expert' }

vi.mock('./context.js', () => ({
  useApp: () => ({
    t: (key: keyof typeof en) => en[key],
    guidance: guidance.current,
  }),
}))

const { RecoveryGuide, UnlockPanel } = await import('./keys.js')

function text(html: string): string {
  const holder = document.createElement('div')
  holder.innerHTML = html
  return holder.textContent ?? ''
}

describe('recovery key screens', () => {
  it('shows the guide, the pair warning, and a print action', () => {
    const html = renderToStaticMarkup(createElement(RecoveryGuide))
    const body = text(html)
    expect(body).toContain(en['keys.guide.print'])
    expect(body).toContain(en['keys.guide.store'])
    expect(body).toContain(en['keys.guide.use'])
    expect(body).toContain(en['keys.guide.lost'])
    expect(body).toContain(en['unlock.unrecoverable'])
    expect(body).toContain(en['keys.pairFiles'])
    expect(html).toContain('recovery-print')
    expect(body).not.toContain('XXXX-XXXX')
  })

  it('shows one password field and hides the hint in expert mode', () => {
    guidance.current = 'guided'
    const guided = renderToStaticMarkup(createElement(UnlockPanel, { mode: 'password', notice: 'failed' }))
    expect(text(guided)).toContain(en['unlock.hint.password'])
    expect(text(guided)).toContain(en['unlock.failed'])
    expect(guided).toContain('type="password"')
    expect(guided).toContain('unlock-recovery')
    guidance.current = 'expert'
    const expert = renderToStaticMarkup(createElement(UnlockPanel, { mode: 'password' }))
    expect(text(expert)).not.toContain(en['unlock.hint.password'])
    guidance.current = 'guided'
    const recovery = renderToStaticMarkup(createElement(UnlockPanel, { mode: 'recovery', notice: 'checksum' }))
    expect(text(recovery)).toContain(en['unlock.hint.recovery'])
    expect(text(recovery)).toContain(en['unlock.recoveryChecksum'])
    const printed = renderToStaticMarkup(createElement(UnlockPanel, { mode: 'print', recoveryKey: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-CCCC', notice: 'rotated' }))
    expect(text(printed)).toContain('XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-CCCC')
    expect(text(printed)).toContain(en['keys.rotateLeftover'])
    expect(text(renderToStaticMarkup(createElement(UnlockPanel, { mode: 'password', notice: 'single-admin' })))).toContain(en['keys.singleAdmin'])
    expect(text(renderToStaticMarkup(createElement(UnlockPanel, { mode: 'password', notice: 'temporary' })))).toContain(en['keys.temporaryPassword'])
    expect(text(renderToStaticMarkup(createElement(UnlockPanel, { mode: 'password', notice: 'old-copies' })))).toContain(en['keys.oldCopies'])
    expect(text(renderToStaticMarkup(createElement(UnlockPanel, { mode: 'password', notice: 'wait' })))).toContain(en['unlock.wait'])
    expect(text(renderToStaticMarkup(createElement(UnlockPanel, { mode: 'password', notice: 'new-admin' })))).toContain(en['unlock.newAdminPassword'])
    expect(text(renderToStaticMarkup(createElement(UnlockPanel, { mode: 'password', notice: 'params' })))).toContain(en['unlock.paramsRejected'])
    expect(text(renderToStaticMarkup(createElement(UnlockPanel, { mode: 'password', notice: 'header' })))).toContain(en['unlock.headerInvalid'])
  })
})
