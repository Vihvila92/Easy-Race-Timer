import { commitEditableDate, formatEditableDate, type MessageKey } from '@ert/i18n'
import { useState, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { useApp } from '../context.js'

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
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'time' | 'email'
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email'
  autoComplete?: string
  testId?: string
}) {
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
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

export function DateField({
  id,
  label,
  value,
  onChange,
  testId,
}: {
  id: string
  label: string
  /** Stored calendar date, `YYYY-MM-DD`, or empty while the text is incomplete. */
  value: string
  onChange: (iso: string) => void
  testId?: string
}) {
  const { locale } = useApp()
  const [text, setText] = useState(() => (value ? formatEditableDate(value, locale) : ''))
  const [localeSeen, setLocaleSeen] = useState(locale)
  if (locale !== localeSeen) {
    setLocaleSeen(locale)
    setText(value ? formatEditableDate(value, locale) : '')
  }
  return (
    <TextField
      id={id}
      label={label}
      value={text}
      onChange={(next) => {
        const committed = commitEditableDate(next, locale)
        setText(committed.text)
        onChange(committed.iso)
      }}
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

export function Banner({ tone, children, testId }: { tone: BannerTone; children: ReactNode; testId?: string }) {
  return (
    <p className={`ui-banner ui-banner-${tone}`} data-testid={testId}>
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
