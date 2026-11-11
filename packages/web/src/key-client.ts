// SPDX-License-Identifier: AGPL-3.0-only
import type { MessageKey } from '@ert/i18n'
import { useCallback, useEffect, useState } from 'react'
import { ApiError, api } from './api.js'
import { keyMessageKey } from './key-errors.js'

export type KeyStateName =
  | 'locked'
  | 'dev'
  | 'admin'
  | 'recovery-gate'
  | 'recovery-unshown'
  | 'temporary-password'

export interface KeyStatus {
  state: KeyStateName
  singleAdmin?: boolean
}

export interface IssuedKey {
  recoveryKey: string
  generation: number
  temporary?: boolean
}

export interface KeyFailure {
  key: MessageKey
  seconds?: number
}

function retrySeconds(error: ApiError): number | undefined {
  const details = error.details
  if (!details || typeof details !== 'object' || !('retryAfterMs' in details)) return undefined
  const ms = details.retryAfterMs
  if (typeof ms !== 'number' || ms <= 0) return undefined
  return Math.max(1, Math.ceil(ms / 1000))
}

export function keyFailure(error: unknown): KeyFailure {
  if (!(error instanceof ApiError)) return { key: 'unlock.failed' }
  const seconds = retrySeconds(error)
  if (seconds) return { key: 'unlock.wait', seconds }
  return { key: keyMessageKey(error.code) ?? 'unlock.failed' }
}

function readKeyStatus(): Promise<KeyStatus> {
  return api<KeyStatus>('/api/v1/keys/status')
}

export function unlockWithAdminPassword(password: string): Promise<KeyStatus> {
  return api<KeyStatus>('/api/v1/keys/unlock', { method: 'POST', body: JSON.stringify({ password }) })
}

export function unlockWithPaper(recoveryKey: string): Promise<KeyStatus> {
  return api<KeyStatus>('/api/v1/keys/recover', { method: 'POST', body: JSON.stringify({ recoveryKey }) })
}

export function changeKeyPassword(body: {
  target?: 'self' | 'other'
  slot?: 0 | 1
  password: string
  confirm: string
  currentPassword?: string
  actingPassword?: string
}): Promise<KeyStatus> {
  return api<KeyStatus>('/api/v1/keys/password', { method: 'POST', body: JSON.stringify(body) })
}

export function regenerateKey(actingPassword: string): Promise<IssuedKey> {
  return api<IssuedKey>('/api/v1/keys/recovery', { method: 'POST', body: JSON.stringify({ actingPassword }) })
}

export function acknowledgeKey(generation: number): Promise<KeyStatus> {
  return api<KeyStatus>('/api/v1/keys/recovery/ack', { method: 'POST', body: JSON.stringify({ generation }) })
}

export function rotateKey(body: { actingPassword: string; other: 'present' | 'temporary'; password: string; confirm: string }): Promise<IssuedKey> {
  return api<IssuedKey>('/api/v1/keys/rotate', { method: 'POST', body: JSON.stringify(body) })
}

const BLOCKING: readonly KeyStateName[] = ['locked', 'recovery-gate', 'recovery-unshown', 'temporary-password']

export function useKeyAccess() {
  const [status, setStatus] = useState<KeyStatus | null>(null)
  const reload = useCallback(async () => {
    try {
      setStatus(await readKeyStatus())
    } catch {
      setStatus({ state: 'dev' })
    }
  }, [])
  useEffect(() => { void reload() }, [reload])
  const state = status?.state
  return {
    status,
    reload,
    blocking: state !== undefined && BLOCKING.includes(state),
    showKeys: state === 'admin',
  }
}
