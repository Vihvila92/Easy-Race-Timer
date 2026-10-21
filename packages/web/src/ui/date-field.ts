import { commitEditableDate, formatEditableDate, parseEditableDate, type Locale } from '@ert/i18n'

export interface DateDraft {
  /** Text that does not match `value`. Null shows the stored date. */
  text: string | null
  focused: boolean
  touched: boolean
  valueSeen: string
}

export function initialDateDraft(value: string): DateDraft {
  return { text: null, focused: false, touched: false, valueSeen: value }
}

/** Follow an external `value` unless the volunteer is still editing. */
export function dateFieldOnValue(draft: DateDraft, value: string): DateDraft {
  if (value === draft.valueSeen) return draft
  if (draft.focused) return { ...draft, valueSeen: value }
  return { ...draft, text: null, valueSeen: value }
}

export function dateFieldOnInput(draft: DateDraft, raw: string, locale: Locale): { draft: DateDraft; iso: string } {
  const committed = commitEditableDate(raw, locale)
  if (committed.iso) {
    return { draft: { ...draft, text: null, focused: true, valueSeen: committed.iso }, iso: committed.iso }
  }
  return { draft: { ...draft, text: raw, focused: true, valueSeen: '' }, iso: '' }
}

export function dateFieldOnFocus(draft: DateDraft): DateDraft {
  return { ...draft, focused: true }
}

export function dateFieldOnBlur(draft: DateDraft): DateDraft {
  return { ...draft, focused: false, touched: true }
}

export function dateFieldShown(value: string, locale: Locale, draft: DateDraft): string {
  if (draft.text != null) return draft.text
  return value ? formatEditableDate(value, locale) : ''
}

/** An error is for after blur. A complete date, including one just corrected, is not an error. */
export function dateFieldInvalid(shown: string, locale: Locale, draft: DateDraft): boolean {
  if (!draft.touched || draft.focused) return false
  return parseEditableDate(shown, locale) == null
}
