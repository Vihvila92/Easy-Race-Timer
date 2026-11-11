// SPDX-License-Identifier: AGPL-3.0-only
import type { MessageKey } from '@ert/i18n'
import { useState } from 'react'
import { useApp } from './context.js'
import { changeKeyPassword, keyFailure, unlockWithAdminPassword, unlockWithPaper } from './key-client.js'
import { Banner, Button, Checkbox, HintFrame, TextField } from './ui/components.js'
import { RecoveryGuide } from './recovery-view.js'

function useSecretForm(submit: (secret: string) => Promise<void>) {
  const [secret, setSecret] = useState('')
  const [notice, setNotice] = useState<MessageKey | undefined>()
  const [seconds, setSeconds] = useState<number | undefined>()
  const send = () => {
    const value = secret
    setSecret('')
    setNotice(undefined)
    submit(value).catch((error: unknown) => {
      const failure = keyFailure(error)
      setNotice(failure.key)
      setSeconds(failure.seconds)
    })
  }
  return { secret, setSecret, notice, seconds, send }
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
  const [mode, setMode] = useState<'password' | 'recovery'>('password')
  const form = useSecretForm(async (secret) => {
    if (mode === 'password') await unlockWithAdminPassword(secret)
    else await unlockWithPaper(secret)
    onUnlocked()
  })
  const hint = mode === 'recovery' ? 'unlock.hint.recovery' : 'unlock.hint.password'
  return (
    <section data-testid="unlock-panel" className="ui-section">
      <h1>{t('unlock.title')}</h1>
      <p className="lead">{t('unlock.lead')}</p>
      <HintFrame hintKey={hint} testId="unlock-hint">
        {mode === 'recovery' ? (
          <TextField id="recovery-key" label={t('unlock.recoveryKey')} value={form.secret} onChange={form.setSecret} testId="recovery-key" autoComplete="off" spellCheck={false} autoCorrect="off" autoCapitalize="characters" />
        ) : (
          <TextField id="unlock-password" label={t('unlock.password')} type="password" value={form.secret} onChange={form.setSecret} testId="unlock-password" autoComplete="current-password" />
        )}
        <UnlockNotice notice={form.notice} seconds={form.seconds} />
        <div className="ui-actions">
          <Button data-testid="unlock-open" onClick={form.send}>{t('unlock.open')}</Button>
          {mode === 'password' ? (
            <Button variant="secondary" data-testid="unlock-recovery" onClick={() => setMode('recovery')}>{t('unlock.useRecovery')}</Button>
          ) : (
            <Button variant="secondary" data-testid="unlock-back" onClick={() => setMode('password')}>{t('unlock.back')}</Button>
          )}
        </div>
      </HintFrame>
    </section>
  )
}

/** After the paper key opens the file, one new admin password is required. */
export function RecoveryGate({ onDone }: { onDone: () => void }) {
  const { t } = useApp()
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
      <h1>{t('unlock.newAdminPassword')}</h1>
      <RecoveryGuide />
      <Banner tone="warning" testId="keys-old-copies">{t('keys.oldCopies')}</Banner>
      <TextField id="gate-password" label={t('keys.newPassword')} type="password" value={password} onChange={setPassword} testId="gate-password" autoComplete="new-password" />
      <TextField id="gate-confirm" label={t('keys.confirmPassword')} type="password" value={confirm} onChange={setConfirm} testId="gate-confirm" autoComplete="new-password" />
      <Checkbox id="other-lost" label={t('unlock.otherLost')} checked={otherLost} onChange={setOtherLost} testId="other-lost" />
      {otherLost ? (
        <>
          <TextField id="gate-other" label={t('keys.otherSlot')} type="password" value={other} onChange={setOther} testId="gate-other" autoComplete="new-password" />
          <TextField id="gate-other-confirm" label={t('keys.confirmPassword')} type="password" value={otherConfirm} onChange={setOtherConfirm} testId="gate-other-confirm" autoComplete="new-password" />
        </>
      ) : null}
      {notice ? <Banner tone="danger" role="alert" testId="unlock-notice">{t(notice)}</Banner> : null}
      <Button data-testid="gate-save" onClick={save}>{t('unlock.setPassword')}</Button>
    </section>
  )
}
