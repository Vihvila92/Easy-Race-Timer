// SPDX-License-Identifier: AGPL-3.0-only
import type { MessageKey } from '@ert/i18n'
import { useEffect, useState } from 'react'
import { useApp } from './context.js'
import { useHeadingFocus } from './focus-heading.js'
import { changeKeyPassword, keyFailure, unlockWithAdminPassword, unlockWithPaper } from './key-client.js'
import { Banner, Button, Checkbox, HintFrame, PasswordPair, TextField } from './ui/components.js'
import { RecoveryGuide } from './recovery-view.js'

function useSecretForm(submit: (secret: string) => Promise<void>) {
  const [secret, setSecret] = useState('')
  const [notice, setNotice] = useState<MessageKey | undefined>()
  const [seconds, setSeconds] = useState<number | undefined>()
  useEffect(() => {
    if (seconds == null) return
    const timer = window.setTimeout(() => setSeconds((current) => (current != null && current > 1 ? current - 1 : undefined)), 1000)
    return () => window.clearTimeout(timer)
  }, [seconds])
  const send = () => {
    const value = secret
    setSecret('')
    setNotice(undefined)
    setSeconds(undefined)
    submit(value).catch((error: unknown) => {
      const failure = keyFailure(error)
      setNotice(failure.key)
      setSeconds(failure.seconds)
    })
  }
  const clear = () => {
    setSecret('')
    setNotice(undefined)
    setSeconds(undefined)
  }
  return { secret, setSecret, notice, seconds, send, clear }
}

function UnlockNotice({ notice, seconds }: { notice?: MessageKey; seconds?: number }) {
  const { t } = useApp()
  if (!notice) return null
  const text = notice === 'unlock.wait' && seconds ? t(notice, { seconds }) : t(notice)
  return <Banner tone="danger" role="alert" testId="unlock-notice">{text}</Banner>
}

/** Locked screen. One password field, or the recovery key, never both at once. */
export function UnlockForm({ onUnlocked }: { onUnlocked: () => void }) {
  const { t } = useApp()
  const heading = useHeadingFocus()
  const [mode, setMode] = useState<'password' | 'recovery'>('password')
  const form = useSecretForm(async (secret) => {
    if (mode === 'password') await unlockWithAdminPassword(secret)
    else await unlockWithPaper(secret)
    onUnlocked()
  })
  const waiting = form.notice === 'unlock.wait' && form.seconds != null
  const hint = mode === 'recovery' ? 'unlock.hint.recovery' : 'unlock.hint.password'
  const switchMode = (next: 'password' | 'recovery') => {
    form.clear()
    setMode(next)
  }
  return (
    <section data-testid="unlock-panel" className="ui-section">
      <h1 ref={heading} tabIndex={-1}>{t('unlock.title')}</h1>
      <p className="lead">{t('unlock.lead')}</p>
      <HintFrame hintKey={hint} testId="unlock-hint">
        <form className="ui-section" onSubmit={(event) => { event.preventDefault(); if (!waiting) form.send() }}>
          {mode === 'recovery' ? (
            <TextField id="recovery-key" label={t('unlock.recoveryKey')} value={form.secret} onChange={form.setSecret} testId="recovery-key" autoComplete="off" spellCheck={false} autoCorrect="off" autoCapitalize="characters" />
          ) : (
            <TextField id="unlock-password" label={t('unlock.password')} type="password" value={form.secret} onChange={form.setSecret} testId="unlock-password" autoComplete="current-password" />
          )}
          <UnlockNotice notice={form.notice} seconds={form.seconds} />
          <div className="ui-actions">
            <Button type="submit" data-testid="unlock-open" disabled={waiting}>{t('unlock.open')}</Button>
            {mode === 'password' ? (
              <Button type="button" variant="secondary" data-testid="unlock-recovery" onClick={() => switchMode('recovery')}>{t('unlock.useRecovery')}</Button>
            ) : (
              <Button type="button" variant="secondary" data-testid="unlock-back" onClick={() => switchMode('password')}>{t('unlock.back')}</Button>
            )}
          </div>
        </form>
      </HintFrame>
    </section>
  )
}

/** After the paper key opens the file, one new admin password is required. */
export function RecoveryGate({ onDone }: { onDone: () => void }) {
  const { t } = useApp()
  const heading = useHeadingFocus()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [otherLost, setOtherLost] = useState(false)
  const [other, setOther] = useState('')
  const [otherConfirm, setOtherConfirm] = useState('')
  const [notice, setNotice] = useState<MessageKey | undefined>()
  const save = () => {
    setNotice(undefined)
    changeKeyPassword({ slot: 0, password, confirm }).then(async () => {
      if (otherLost) await changeKeyPassword({ target: 'other', actingPassword: password, password: other, confirm: otherConfirm })
      onDone()
    }).catch((error: unknown) => setNotice(keyFailure(error).key))
  }
  return (
    <section data-testid="recovery-gate" className="ui-section">
      <h1 ref={heading} tabIndex={-1}>{t('unlock.newAdminPassword')}</h1>
      <RecoveryGuide />
      <form className="ui-section" onSubmit={(event) => { event.preventDefault(); save() }}>
        <Banner tone="warning" testId="keys-old-copies">{t('keys.oldCopies')}</Banner>
        <PasswordPair passwordId="gate-password" confirmId="gate-confirm" passwordLabel={t('keys.newPassword')} confirmLabel={t('keys.confirmPassword')} password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} passwordTestId="gate-password" confirmTestId="gate-confirm" />
        <Checkbox id="other-lost" label={t('unlock.otherLost')} checked={otherLost} onChange={setOtherLost} testId="other-lost" />
        {otherLost ? (
          <PasswordPair passwordId="gate-other" confirmId="gate-other-confirm" passwordLabel={t('keys.otherSlot')} confirmLabel={t('keys.confirmPassword')} password={other} confirm={otherConfirm} onPassword={setOther} onConfirm={setOtherConfirm} passwordTestId="gate-other" confirmTestId="gate-other-confirm" />
        ) : null}
        {notice ? <Banner tone="danger" role="alert" testId="unlock-notice">{t(notice)}</Banner> : null}
        <Button type="submit" data-testid="gate-save">{t('unlock.setPassword')}</Button>
      </form>
    </section>
  )
}
