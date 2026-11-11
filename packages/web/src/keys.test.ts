// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { en, fi } from '@ert/i18n'

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
  regenerateKey: vi.fn(async () => ({ recoveryKey: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-CCCC', generation: 4 })),
  keyFailure: () => ({ key: 'unlock.failed' }),
  unlockWithAdminPassword: vi.fn(),
  unlockWithPaper: vi.fn(),
  changeKeyPassword: vi.fn(),
}))

const { RecoveryGuide, RecoveryPrint } = await import('./recovery-view.js')
const { UnlockForm } = await import('./unlock-view.js')
const { KeyManage } = await import('./key-manage.js')
const { acknowledgeKey } = await import('./key-client.js')

function text(html: string): string {
  const holder = document.createElement('div')
  holder.innerHTML = html
  return holder.textContent ?? ''
}

const PAPER = 'Print the recovery key on paper. Do not save it as a PDF.'

describe('recovery guide', () => {
  it('shows the unrecoverable-data warning and the paper instruction', () => {
    const html = renderToStaticMarkup(createElement(RecoveryGuide))
    const body = text(html)
    expect(body).toContain(PAPER)
    expect(body).toContain(en['unlock.unrecoverable'])
    expect(body).toContain(en['keys.guide.store'])
    expect(body).toContain(en['keys.pairFiles'])
    expect(body).toContain('You can type the letter O instead of 0, and I or L instead of 1.')
    expect(en['keys.pairFiles']).toContain('race file')
    expect(en['keys.pairFiles']).not.toContain('database')
    expect(en['keys.guide.lost']).toContain('race file')
    expect(fi['keys.guide.use']).toContain('O-kirjaimen nollan sijaan')
    expect(fi['keys.guide.use']).toContain('Valitse lukitulla näytöllä')
    expect(fi['keys.guide.store']).toContain('talon vara-avain')
    expect(fi['keys.guide.store']).toContain('merkityssä kirjekuoressa')
    expect(fi['keys.pairFiles']).toContain('kisatiedosto')
    expect(fi['keys.pairFiles']).not.toContain('kisatietokanta')
    expect(fi['keys.guide.lost']).toContain('kisatiedosto')
    expect(fi['keys.guide.lost']).not.toContain('tietokanta')
    expect(fi['unlock.failed']).toBe('Tiedosto ei auennut. Tarkista salasana tai käytä tulostettua palautusavainta.')
    expect(en['unlock.lead']).toBe('Type your admin password.')
    expect(fi['unlock.lead']).toBe('Kirjoita oma ylläpitäjän salasanasi.')
    expect(en['unlock.hint.password']).toContain('The program does not tell whose password was wrong.')
    expect(fi['unlock.hint.password']).toContain('Ohjelma ei kerro, kenen salasana oli väärä.')
    expect(en['keys.rotate']).toBe('Change the data key')
    expect(en['keys.lead']).toContain('changing the data key')
    expect(en['keys.oldCopies']).toContain('Changing the data key')
    expect(en['keys.ack']).toBe('I have printed or written down this key')
    expect(fi['keys.ack']).toBe('Olen tulostanut tai kirjoittanut ylös tämän avaimen')
    expect(en['keys.rotateLeftover']).toContain('USB stick')
    expect(fi['keys.rotateLeftover']).toContain('muistitikkua')
    expect(fi['keys.guide.print'].startsWith('Tulostus.')).toBe(true)
    expect(fi['keys.guide.print']).toContain('Tulosta palautusavain paperille.')
    expect(body).not.toContain('XXXX-XXXX')
  })
})

describe('print view', () => {
  it('shows the recovery key only on the print view and clears it after printing', async () => {
    const secret = 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-CCCC'
    const printed = renderToStaticMarkup(createElement(RecoveryPrint, {
      recoveryKey: secret,
      generation: 1,
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

describe('key management print', () => {
  it('keeps the acknowledgement step after printing', async () => {
    const secret = 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-CCCC'
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(createElement(KeyManage, { state: 'admin', onChanged: () => undefined }))
    })
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="recovery-regenerate"]')?.click()
    })
    expect(host.textContent).toContain(secret)
    await act(async () => {
      window.dispatchEvent(new Event('afterprint'))
    })
    expect(host.textContent).not.toContain(secret)
    expect(host.querySelector('[data-testid="recovery-ack-submit"]')).toBeTruthy()
    const box = host.querySelector<HTMLInputElement>('[data-testid="recovery-ack"]')
    await act(async () => { box?.click() })
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="recovery-ack-submit"]')?.click()
    })
    expect(acknowledgeKey).toHaveBeenCalledWith(4)
    expect(host.querySelector('[data-testid="key-manage"]')).toBeTruthy()
    await act(async () => { root.unmount() })
    expect(host.textContent).not.toContain(secret)
    host.remove()
  })
})
