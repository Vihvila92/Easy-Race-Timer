// SPDX-License-Identifier: AGPL-3.0-only
import type { MessageKey } from '@ert/i18n'
import { useState, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type FocusEventHandler, type ReactNode } from 'react'
import { useApp } from '../context.js'
import {
  dateFieldInvalid,
  dateFieldOnBlur,
  dateFieldOnFocus,
  dateFieldOnInput,
  dateFieldOnValue,
  dateFieldShown,
  initialDateDraft,
} from './date-field.js'

type ButtonVariant = 'primary' | 'secondary' | 'danger'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
}

export function Button({ variant = 'primary', className, type = 'button', ...rest }: ButtonProps) {
  const classes = ['ui-button', `ui-button-${variant}`, className].filter(Boolean).join(' ')
  return <button type={type} className={classes} {...rest} />
}

export function TextField({
  id,
  label,
  value,
  onChange,
  type = 'text',
  inputMode,
  autoComplete,
  testId,
  hint,
  error,
  onBlur,
  onFocus,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'time' | 'email'
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email'
  autoComplete?: string
  testId?: string
  hint?: string
  error?: string
  onBlur?: FocusEventHandler<HTMLInputElement>
  onFocus?: FocusEventHandler<HTMLInputElement>
}) {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ')
  return (
    <div className="ui-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        inputMode={inputMode}
        autoComplete={autoComplete}
        data-testid={testId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        onBlur={onBlur}
        onFocus={onFocus}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint ? <p className="ui-field-hint" id={hintId} data-testid={testId ? `${testId}-hint` : undefined}>{hint}</p> : null}
      {error ? <p className="ui-field-error" id={errorId} role="alert" data-testid={testId ? `${testId}-error` : undefined}>{error}</p> : null}
    </div>
  )
}

export function DateField({
  id,
  label,
  hint,
  errorMessage,
  value,
  onChange,
  testId,
}: {
  id: string
  label: string
  hint: string
  errorMessage: string
  /** Stored calendar date, `YYYY-MM-DD`, or empty while the text is incomplete. */
  value: string
  onChange: (iso: string) => void
  testId?: string
}) {
  const { locale } = useApp()
  const [draft, setDraft] = useState(() => initialDateDraft(value))
  const synced = value === draft.valueSeen ? draft : dateFieldOnValue(draft, value)
  if (synced !== draft) setDraft(synced)
  const shown = dateFieldShown(value, locale, synced)
  const invalid = dateFieldInvalid(shown, locale, synced)
  return (
    <TextField
      id={id}
      label={label}
      hint={hint}
      error={invalid ? errorMessage : undefined}
      value={shown}
      onChange={(next) => {
        const result = dateFieldOnInput(synced, next, locale)
        setDraft(result.draft)
        onChange(result.iso)
      }}
      onFocus={() => setDraft((current) => dateFieldOnFocus(current))}
      onBlur={() => setDraft((current) => dateFieldOnBlur(current))}
      autoComplete="off"
      inputMode="text"
      testId={testId}
    />
  )
}

type TextLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { testId?: string }

/** Inline link with a 44 px target. Navigation items keep the nav-link treatment. */
export function TextLink({ className, testId, children, ...rest }: TextLinkProps) {
  const classes = ['ui-text-link', className].filter(Boolean).join(' ')
  return <a className={classes} data-testid={testId} {...rest}><span>{children}</span></a>
}

export function Checkbox({
  id,
  label,
  checked,
  onChange,
  testId,
}: {
  id: string
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  testId?: string
}) {
  return (
    <label className="ui-check" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        data-testid={testId}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  )
}

export function Select({
  id,
  label,
  value,
  onChange,
  options,
  testId,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  testId?: string
}) {
  return (
    <div className="ui-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} data-testid={testId} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  )
}

type BannerTone = 'info' | 'warning' | 'danger' | 'ok'

export function Banner({
  tone,
  children,
  testId,
  role,
}: {
  tone: BannerTone
  children: ReactNode
  testId?: string
  role?: 'alert' | 'status'
}) {
  const live = role === 'status' ? 'polite' : role === 'alert' ? 'assertive' : undefined
  return (
    <p
      className={`ui-banner ui-banner-${tone}`}
      role={role}
      aria-live={live}
      aria-atomic={live ? true : undefined}
      data-testid={testId}
    >
      {children}
    </p>
  )
}

export function ListRow({
  title,
  detail,
  trailing,
  pressed,
  onPress,
  testId,
}: {
  title: string
  detail?: string
  trailing?: ReactNode
  pressed?: boolean
  onPress?: () => void
  testId?: string
}) {
  const body = (
    <>
      <span className="ui-row-copy">
        <span className="ui-row-title">{title}</span>
        {detail ? <span className="ui-row-detail">{detail}</span> : null}
      </span>
      {trailing}
    </>
  )
  if (!onPress) return <div className="ui-row">{body}</div>
  return (
    <button type="button" className="ui-row" aria-pressed={pressed} data-testid={testId} onClick={onPress}>
      {body}
    </button>
  )
}

type BadgeTone = 'neutral' | 'ok' | 'warning' | 'danger'

export function StatusBadge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <span className={`ui-badge ui-badge-${tone}`}>{children}</span>
}

export function Clock({ value, label, testId }: { value: string; label: string; testId?: string }) {
  return (
    <div className="ui-clock" data-testid={testId}>
      <p className="ui-clock-label">{label}</p>
      <p className="ui-clock-value">{value}</p>
    </div>
  )
}

/** Inline hint inside a view. It is not a dialog, and it renders only in guided mode. */
export function HintFrame({ hintKey, testId, children }: { hintKey: MessageKey; testId: string; children: ReactNode }) {
  const { guidance, t } = useApp()
  return (
    <div className="ui-frame">
      {guidance === 'guided' ? (
        <p className="ui-hint" data-testid={testId}>{t(hintKey)}</p>
      ) : null}
      {children}
    </div>
  )
}
