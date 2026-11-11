// SPDX-License-Identifier: AGPL-3.0-only
import type { MessageKey } from '@ert/i18n'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useApp } from './context.js'
import { useHeadingFocus } from './focus-heading.js'
import { changeKeyPassword, openFileFailure, regenerateKey, rotateKey, type IssuedKey, type KeyFileLabel, type KeyStateName } from './key-client.js'
import { RecoveryGuide, RecoveryPrint } from './recovery-view.js'
import { RecoveryGate, UnlockForm } from './unlock-view.js'
import { Banner, Button, PasswordPair, Select, TextField } from './ui/components.js'

function Notice({ code }: { code?: MessageKey }) {
  const { t } = useApp()
  if (!code) return null
  return <Banner tone="danger" role="alert" testId="unlock-notice">{t(code)}</Banner>
}

function ConfirmStep({ warning, label, testId }: { warning: string; label: string; testId: string }) {
  return (
    <>
      <Banner tone="warning" testId={`${testId}-warning`}>{warning}</Banner>
      <Button variant="danger" type="submit" data-testid={testId}>{label}</Button>
    </>
  )
}

function useConfirm(run: () => void) {
  const [open, setOpen] = useState(false)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!open) {
      setOpen(true)
      return
    }
    run()
  }
  return { open, submit, close: () => setOpen(false) }
}

function PasswordChange({ onSingleAdmin, onChanged }: { onSingleAdmin: () => void; onChanged: () => void }) {
  const { t } = useApp()
  const [target, setTarget] = useState<'self' | 'other'>('self')
  const [currentPassword, setCurrent] = useState('')
  const [actingPassword, setActing] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [notice, setNotice] = useState<MessageKey | undefined>()
  const [saved, setSaved] = useState(false)
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setNotice(undefined)
    setSaved(false)
    const acting = target === 'other' ? actingPassword : undefined
    const current = target === 'self' ? currentPassword : undefined
    changeKeyPassword({ target, password, confirm, currentPassword: current, actingPassword: acting }).then((status) => {
      setCurrent('')
      setActing('')
      setPassword('')
      setConfirm('')
      setSaved(true)
      if (status.singleAdmin) onSingleAdmin()
      onChanged()
    }).catch((error: unknown) => setNotice(openFileFailure(error, 'keys.passwordWrong').key))
  }
  return (
    <section data-testid="password-change" className="ui-section" aria-labelledby="password-task">
      <h2 id="password-task">{t('keys.change')}</h2>
      <form className="ui-section" onSubmit={save}>
        <Banner tone="warning" testId="keys-old-copies">{t('keys.oldCopies')}</Banner>
        <Select id="password-target" label={t('keys.passwordTarget')} value={target} onChange={(value) => setTarget(value === 'other' ? 'other' : 'self')} testId="password-target" options={[
          { value: 'self', label: t('keys.mySlot') },
          { value: 'other', label: t('keys.otherSlot') },
        ]} />
        {target === 'self' ? <TextField id="current-password" label={t('keys.currentPassword')} type="password" value={currentPassword} onChange={setCurrent} testId="current-password" autoComplete="current-password" /> : <TextField id="acting-change" label={t('keys.actingPassword')} type="password" value={actingPassword} onChange={setActing} testId="acting-change" autoComplete="current-password" />}
        <PasswordPair passwordId="new-password" confirmId="confirm-password" passwordLabel={t('keys.newPassword')} confirmLabel={t('keys.confirmPassword')} password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} passwordTestId="new-password" confirmTestId="confirm-password" />
        <Notice code={notice} />
        {saved ? <Banner tone="ok" testId="keys-password-saved">{t('keys.passwordSaved')}</Banner> : null}
        <Button type="submit" data-testid="password-save">{t('keys.change')}</Button>
      </form>
    </section>
  )
}

function RotationForm({ onIssued }: { onIssued: (issued: IssuedKey) => void }) {
  const { t } = useApp()
  const [actingPassword, setActing] = useState('')
  const [other, setOther] = useState<'present' | 'temporary'>('present')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [notice, setNotice] = useState<MessageKey | undefined>()
  const present = other === 'present'
  const save = () => {
    setNotice(undefined)
    rotateKey({ actingPassword, other, password, confirm }).then((issued) => {
      setActing('')
      setPassword('')
      setConfirm('')
      onIssued(issued)
    }).catch((error: unknown) => setNotice(openFileFailure(error, 'keys.passwordWrong').key))
  }
  const step = useConfirm(save)
  return (
    <section data-testid="key-rotation" className="ui-section" aria-labelledby="rotation-task">
      <h2 id="rotation-task">{t('keys.rotate')}</h2>
      <form className="ui-section" onSubmit={step.submit}>
        <TextField id="acting-password" label={t('keys.actingPassword')} type="password" value={actingPassword} onChange={setActing} testId="acting-password" autoComplete="current-password" />
        <Select id="other-mode" label={t('keys.otherMode')} value={other} onChange={(value) => { setOther(value === 'temporary' ? 'temporary' : 'present'); step.close() }} testId="other-mode" options={[
          { value: 'present', label: t('keys.otherPresent') },
          { value: 'temporary', label: t('keys.temporaryChoice') },
        ]} />
        <PasswordPair passwordId="other-password" confirmId="other-confirm" passwordLabel={present ? t('keys.otherCurrent') : t('keys.newPassword')} confirmLabel={present ? t('keys.otherCurrentAgain') : t('keys.confirmPassword')} password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} passwordTestId="other-password" confirmTestId="other-confirm" />
        <Notice code={notice} />
        {step.open ? <ConfirmStep warning={t('keys.oldCopies')} label={t('keys.confirmRotate')} testId="rotate-confirm" /> : <Button variant="danger" type="submit" data-testid="rotate-save">{t('keys.rotate')}</Button>}
      </form>
    </section>
  )
}

function RegenerateKey({ onIssued }: { onIssued: (issued: IssuedKey) => void }) {
  const { t } = useApp()
  const [actingPassword, setActing] = useState('')
  const [notice, setNotice] = useState<MessageKey | undefined>()
  const save = () => {
    setNotice(undefined)
    regenerateKey(actingPassword).then((issued) => {
      setActing('')
      onIssued(issued)
    }).catch((error: unknown) => setNotice(openFileFailure(error, 'keys.passwordWrong').key))
  }
  const step = useConfirm(save)
  return (
    <form className="ui-section" data-testid="key-regenerate" onSubmit={step.submit}>
      <TextField id="regenerate-password" label={t('keys.actingPassword')} type="password" value={actingPassword} onChange={setActing} testId="regenerate-password" autoComplete="current-password" />
      <Notice code={notice} />
      {step.open ? <ConfirmStep warning={t('keys.oldCopies')} label={t('keys.confirmRegenerate')} testId="recovery-regenerate-confirm" /> : <Button variant="danger" type="submit" data-testid="recovery-regenerate">{t('keys.regenerate')}</Button>}
    </form>
  )
}

export function KeyManage({ state, label = {}, onChanged }: { state: KeyStateName; label?: KeyFileLabel; onChanged: () => void }) {
  const { t } = useApp()
  const heading = useHeadingFocus()
  const [issued, setIssued] = useState<IssuedKey | null>(null)
  const [singleAdmin, setSingleAdmin] = useState(false)
  const hideKey = useCallback(() => {
    setIssued((current) => (current ? { ...current, recoveryKey: '' } : current))
  }, [])
  useEffect(() => {
    if (!issued) heading.current?.focus()
  }, [issued, heading])
  if (issued) {
    return (
      <RecoveryPrint
        recoveryKey={issued.recoveryKey}
        generation={issued.generation}
        onKeyHidden={hideKey}
        label={label}
        onAcknowledged={() => { setIssued(null); onChanged() }}
        extra={(
          <>
            {issued.temporary ? <Banner tone="warning" testId="keys-temporary">{t('keys.temporaryPassword')}</Banner> : null}
            {issued.temporary !== undefined ? <Banner tone="info" testId="keys-leftover">{t('keys.rotateLeftover')}</Banner> : null}
          </>
        )}
      />
    )
  }
  return (
    <section data-testid="key-manage">
      <h1 ref={heading} tabIndex={-1}>{t('keys.title')}</h1>
      <p className="lead">{t('keys.lead')}</p>
      {state === 'temporary-password' ? <Banner tone="warning" testId="keys-temporary-holder">{t('keys.temporaryHolder')}</Banner> : null}
      {state === 'recovery-unshown' ? <Banner tone="warning" testId="keys-unshown">{t('keys.recoveryUnshown')}</Banner> : null}
      {singleAdmin ? <Banner tone="warning" testId="keys-single-admin">{t('keys.singleAdmin')}</Banner> : null}
      <PasswordChange onSingleAdmin={() => setSingleAdmin(true)} onChanged={onChanged} />
      <section className="ui-section" data-testid="key-regenerate-task" aria-labelledby="regenerate-task">
        <h2 id="regenerate-task">{t('keys.regenerate')}</h2>
        <RecoveryGuide />
        <RegenerateKey onIssued={setIssued} />
      </section>
      <RotationForm onIssued={setIssued} />
    </section>
  )
}

/** Full-screen key step. The rest of the race stays hidden until this is done. */
export function KeyGate({ state, label = {}, reload }: { state: KeyStateName; label?: KeyFileLabel; reload: () => void }) {
  if (state === 'locked') return <UnlockForm onUnlocked={reload} />
  if (state === 'recovery-gate') return <RecoveryGate onDone={reload} />
  return <KeyManage state={state} label={label} onChanged={reload} />
}
