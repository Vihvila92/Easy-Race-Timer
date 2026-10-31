// SPDX-License-Identifier: AGPL-3.0-only
import { Button, HintFrame, TextField } from './ui/components.js'
import { useApp } from './context.js'

/** Plain-language recovery guide. It is on setup, the print view, and About. */
export function RecoveryGuide() {
  const { t } = useApp()
  return (
    <div data-testid="recovery-guide">
      <p>{t('keys.guide.print')}</p>
      <p>{t('keys.guide.store')}</p>
      <p>{t('keys.guide.use')}</p>
      <p>{t('keys.guide.lost')}</p>
      <p data-testid="recovery-unrecoverable">{t('unlock.unrecoverable')}</p>
      <p data-testid="recovery-pair">{t('keys.pairFiles')}</p>
      <Button data-testid="recovery-print" onClick={() => window.print()}>{t('keys.print')}</Button>
    </div>
  )
}

export type UnlockNotice =
  | 'failed'
  | 'wait'
  | 'checksum'
  | 'params'
  | 'header'
  | 'new-admin'
  | 'old-copies'
  | 'single-admin'
  | 'temporary'
  | 'rotated'

/** Locked screen. One password field. The recovery path is a separate control. */
export function UnlockPanel({
  mode,
  notice,
  recoveryKey,
}: {
  mode: 'password' | 'recovery' | 'print'
  notice?: UnlockNotice
  recoveryKey?: string
}) {
  const { t } = useApp()
  const noticeKey = notice === 'failed'
    ? 'unlock.failed'
    : notice === 'wait'
      ? 'unlock.wait'
      : notice === 'checksum'
        ? 'unlock.recoveryChecksum'
        : notice === 'params'
          ? 'unlock.paramsRejected'
          : notice === 'header'
            ? 'unlock.headerInvalid'
            : notice === 'new-admin'
              ? 'unlock.newAdminPassword'
              : notice === 'old-copies'
                ? 'keys.oldCopies'
                : notice === 'single-admin'
                  ? 'keys.singleAdmin'
                  : notice === 'temporary'
                    ? 'keys.temporaryPassword'
                    : notice === 'rotated'
                      ? 'keys.rotateLeftover'
                      : null
  return (
    <section data-testid="unlock-panel">
      {mode === 'print' ? (
        <>
          {recoveryKey ? <p data-testid="recovery-groups">{recoveryKey}</p> : null}
          <RecoveryGuide />
          {noticeKey ? <p role="alert" data-testid="unlock-notice">{t(noticeKey)}</p> : null}
        </>
      ) : (
        <HintFrame hintKey={mode === 'recovery' ? 'unlock.hint.recovery' : 'unlock.hint.password'} testId="unlock-hint">
          {mode === 'recovery' ? (
            <TextField id="recovery-key" label={t('unlock.recoveryKey')} value="" onChange={() => undefined} testId="recovery-key" autoComplete="off" />
          ) : (
            <TextField id="unlock-password" label={t('unlock.password')} type="password" value="" onChange={() => undefined} testId="unlock-password" autoComplete="current-password" />
          )}
          {noticeKey ? <p role="alert" data-testid="unlock-notice">{t(noticeKey)}</p> : null}
          <div className="ui-actions">
            <Button data-testid="unlock-open">{t('unlock.open')}</Button>
            {mode === 'password' ? <Button variant="secondary" data-testid="unlock-recovery">{t('unlock.useRecovery')}</Button> : null}
          </div>
        </HintFrame>
      )}
    </section>
  )
}
