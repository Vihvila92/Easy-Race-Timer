// SPDX-License-Identifier: AGPL-3.0-only
import type { MessageKey } from '@ert/i18n'
import { useCallback, useState } from 'react'
import { useApp } from './context.js'
import { changeKeyPassword, keyFailure, regenerateKey, rotateKey, type IssuedKey, type KeyStateName } from './key-client.js'
import { RecoveryGuide, RecoveryPrint } from './recovery-view.js'
import { RecoveryGate, UnlockForm } from './unlock-view.js'
import { Banner, Button, Select, TextField } from './ui/components.js'

function Notice({ code }: { code?: MessageKey }) {
  const { t } = useApp()
  if (!code) return null
  return <Banner tone="danger" role="alert" testId="unlock-notice">{t(code)}</Banner>
}

function PasswordChange({ onSingleAdmin }: { onSingleAdmin: () => void }) {
  const { t } = useApp()
  const [target, setTarget] = useState<'self' | 'other'>('self')
  const [currentPassword, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [notice, setNotice] = useState<MessageKey | undefined>()
  const save = () => {
    setNotice(undefined)
    changeKeyPassword({ target, password, confirm, currentPassword: target === 'self' ? currentPassword : undefined }).then((status) => {
      setCurrent('')
      setPassword('')
      setConfirm('')
      if (status.singleAdmin) onSingleAdmin()
    }).catch((error: unknown) => setNotice(keyFailure(error).key))
  }
  return (
    <section data-testid="password-change" className="ui-section">
      <h2>{t('keys.change')}</h2>
      <Banner tone="warning" testId="keys-old-copies">{t('keys.oldCopies')}</Banner>
      <Select id="password-target" label={t('keys.change')} value={target} onChange={(value) => setTarget(value === 'other' ? 'other' : 'self')} testId="password-target" options={[
        { value: 'self', label: t('keys.mySlot') },
        { value: 'other', label: t('keys.otherSlot') },
      ]} />
      {target === 'self' ? <TextField id="current-password" label={t('keys.currentPassword')} type="password" value={currentPassword} onChange={setCurrent} testId="current-password" autoComplete="current-password" /> : null}
      <TextField id="new-password" label={t('keys.newPassword')} type="password" value={password} onChange={setPassword} testId="new-password" autoComplete="new-password" />
      <TextField id="confirm-password" label={t('keys.confirmPassword')} type="password" value={confirm} onChange={setConfirm} testId="confirm-password" autoComplete="new-password" />
      <Notice code={notice} />
      <Button data-testid="password-save" onClick={save}>{t('keys.change')}</Button>
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
  const save = () => {
    setNotice(undefined)
    rotateKey({ actingPassword, other, password, confirm }).then((issued) => {
      setActing('')
      setPassword('')
      setConfirm('')
      onIssued(issued)
    }).catch((error: unknown) => setNotice(keyFailure(error).key))
  }
  return (
    <section data-testid="key-rotation" className="ui-section">
      <h2>{t('keys.rotate')}</h2>
      <Banner tone="warning" testId="keys-rotate-copies">{t('keys.oldCopies')}</Banner>
      <Banner tone="info" testId="keys-pair">{t('keys.pairFiles')}</Banner>
      <TextField id="acting-password" label={t('keys.actingPassword')} type="password" value={actingPassword} onChange={setActing} testId="acting-password" autoComplete="current-password" />
      <Select id="other-mode" label={t('keys.otherSlot')} value={other} onChange={(value) => setOther(value === 'temporary' ? 'temporary' : 'present')} testId="other-mode" options={[
        { value: 'present', label: t('keys.otherPresent') },
        { value: 'temporary', label: t('keys.temporaryChoice') },
      ]} />
      <TextField id="other-password" label={t('keys.newPassword')} type="password" value={password} onChange={setPassword} testId="other-password" autoComplete="new-password" />
      <TextField id="other-confirm" label={t('keys.confirmPassword')} type="password" value={confirm} onChange={setConfirm} testId="other-confirm" autoComplete="new-password" />
      <Notice code={notice} />
      <Button data-testid="rotate-save" onClick={save}>{t('keys.rotate')}</Button>
    </section>
  )
}

export function KeyManage({ state, onChanged }: { state: KeyStateName; onChanged: () => void }) {
  const { t } = useApp()
  const [issued, setIssued] = useState<IssuedKey | null>(null)
  const [singleAdmin, setSingleAdmin] = useState(false)
  const [notice, setNotice] = useState<MessageKey | undefined>()
  const clear = useCallback(() => setIssued(null), [])
  const regenerate = () => {
    setNotice(undefined)
    regenerateKey().then(setIssued).catch((error: unknown) => setNotice(keyFailure(error).key))
  }
  if (issued) {
    return (
      <RecoveryPrint
        recoveryKey={issued.recoveryKey}
        generation={issued.generation}
        onClear={clear}
        onAcknowledged={() => { clear(); onChanged() }}
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
      <h1>{t('keys.title')}</h1>
      <p className="lead">{t('keys.lead')}</p>
      {state === 'temporary-password' ? <Banner tone="warning" testId="keys-temporary">{t('keys.temporaryPassword')}</Banner> : null}
      {singleAdmin ? <Banner tone="warning" testId="keys-single-admin">{t('keys.singleAdmin')}</Banner> : null}
      <Notice code={notice} />
      <PasswordChange onSingleAdmin={() => setSingleAdmin(true)} />
      <RecoveryGuide />
      <Button data-testid="recovery-regenerate" onClick={regenerate}>{t('keys.regenerate')}</Button>
      <RotationForm onIssued={setIssued} />
    </section>
  )
}

/** Full-screen key step. The rest of the race stays hidden until this is done. */
export function KeyGate({ state, reload }: { state: KeyStateName; reload: () => void }) {
  if (state === 'locked') return <UnlockForm onUnlocked={reload} />
  if (state === 'recovery-gate') return <RecoveryGate onDone={reload} />
  return <KeyManage state={state} onChanged={reload} />
}
