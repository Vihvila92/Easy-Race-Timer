import { translate, type Locale } from '@ert/i18n'

export interface BlockerLink {
  href: string
  text: string
}

/** Turn a lock-blocker id into the link a volunteer can read. Unknown ids stay visible. */
export function blockerLink(id: string, locale: Locale): BlockerLink {
  if (id.startsWith('tie:')) {
    const rest = id.slice(4)
    const cut = rest.indexOf(':')
    if (cut > 0) {
      return {
        href: '#/ties',
        text: translate(locale, 'results.blocker.tie', { race: rest.slice(0, cut), time: rest.slice(cut + 1) }),
      }
    }
  }
  const entry = /^entry:(.+):no_result$/.exec(id)
  if (entry) {
    return { href: '#/entries', text: translate(locale, 'results.blocker.noResult', { bib: entry[1] }) }
  }
  const unassigned = /^time:(.+):unassigned$/.exec(id)
  if (unassigned) {
    return { href: '#/entries', text: translate(locale, 'results.blocker.unassigned', { id: unassigned[1] }) }
  }
  const before = /^time:(.+):before_start$/.exec(id)
  if (before) {
    return { href: '#/entries', text: translate(locale, 'results.blocker.beforeStart', { id: before[1] }) }
  }
  return { href: id.startsWith('tie:') ? '#/ties' : '#/entries', text: id }
}
