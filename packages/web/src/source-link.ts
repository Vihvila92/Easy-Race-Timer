// SPDX-License-Identifier: AGPL-3.0-only
const REPO = 'https://github.com/Vihvila92/Easy-Race-Timer'

export interface SourceRevisionInput {
  envRef?: string
  exactTag?: string | null
  commit?: string | null
}

/** Tag when HEAD is exactly that tag, otherwise the full commit. Never the repository home. */
export function resolveSourceRef(input: SourceRevisionInput): string {
  const fromEnv = input.envRef?.trim()
  if (fromEnv) return canonicalRevision(fromEnv)
  const tag = input.exactTag?.trim()
  if (tag) return canonicalRevision(tag)
  return canonicalRevision(input.commit?.trim() ?? '')
}

export function sourceCodeUrl(ref: string): string {
  const revision = canonicalRevision(ref)
  if (isCommit(revision)) return `${REPO}/commit/${revision}`
  return `${REPO}/tree/${encodeURIComponent(revision)}`
}

export function licenseUrl(ref: string): string {
  return `${REPO}/blob/${encodeURIComponent(canonicalRevision(ref))}/LICENSE`
}

function canonicalRevision(ref: string): string {
  const value = ref.trim()
  if (!value || value === '.' || value.includes('..')) throw new Error('source revision is not a tag or commit')
  if (/^[0-9a-f]{40}$/i.test(value)) return value.toLowerCase()
  if (/^[A-Za-z0-9._-]{1,128}$/.test(value)) return value
  throw new Error('source revision is not a tag or commit')
}

function isCommit(ref: string): boolean {
  return /^[0-9a-f]{40}$/.test(ref)
}
