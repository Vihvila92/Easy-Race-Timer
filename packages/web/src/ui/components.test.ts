// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Banner } from './components.js'

function banner(role?: 'alert' | 'status'): HTMLElement {
  const html = renderToStaticMarkup(createElement(Banner, { tone: 'info', role, testId: 'banner', children: 'Hello' }))
  const holder = document.createElement('div')
  holder.innerHTML = html
  const node = holder.firstElementChild
  if (!(node instanceof HTMLElement)) throw new Error('banner did not render')
  return node
}

describe('Banner live region', () => {
  it('derives politeness from role and sets neither when role is omitted', () => {
    const status = banner('status')
    expect(status.getAttribute('role')).toBe('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.getAttribute('aria-atomic')).toBe('true')

    const alert = banner('alert')
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.getAttribute('aria-live')).toBe('assertive')
    expect(alert.getAttribute('aria-atomic')).toBe('true')

    const plain = banner()
    expect(plain.hasAttribute('role')).toBe(false)
    expect(plain.hasAttribute('aria-live')).toBe(false)
    expect(plain.hasAttribute('aria-atomic')).toBe(false)
  })
})
