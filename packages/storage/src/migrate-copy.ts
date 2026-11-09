// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { atomicCopyFile, fsyncDirectory, fsyncFile, secureRemove } from './atomic.js'
import { openEncrypted, restrictPermissions, unlock, type SqliteDatabase } from './cipher.js'
import { backupPairComplete, keyFilePath, writeKeyStub } from './key-file.js'
import { ensureFileId, MIGRATIONS, SCHEMA_SQL, SCHEMA_VERSION } from './schema.js'
import { APP_VERSION, checkpointIfPending, columnNames, migrationHooks, peekFileId, purgeBirthDateColumn, removeMigrationTemp } from './db.js'

function applyMigrations(raw: SqliteDatabase, fromVersion: number, preferred: string): void {
  raw.exec(SCHEMA_SQL)
  for (const migration of MIGRATIONS) {
    if (migration.version > fromVersion && migration.version <= SCHEMA_VERSION) migration.up(raw)
  }
  raw.prepare('UPDATE schema_meta SET schema_version = ?, app_version = ? WHERE id = 1').run(SCHEMA_VERSION, APP_VERSION)
  ensureFileId(raw, preferred)
  migrationHooks.beforeCommit?.()
}

function copyMigrationPair(filePath: string, backup: string, preferred: string): void {
  if (migrationHooks.failBackup) throw new Error('disk full')
  atomicCopyFile(filePath, backup)
  if (!fs.readFileSync(filePath).equals(fs.readFileSync(backup))) throw new Error('backup bytes differ')
  const sourceKey = keyFilePath(filePath)
  const backupKey = keyFilePath(backup)
  if (backupPairComplete(filePath)) atomicCopyFile(sourceKey, backupKey)
  else writeKeyStub(backupKey, preferred)
  const copied = fs.existsSync(sourceKey) && backupPairComplete(filePath)
  if (copied && !fs.readFileSync(sourceKey).equals(fs.readFileSync(backupKey))) throw new Error('key backup bytes differ')
  fsyncDirectory(path.dirname(backup))
}

function backupBeforeMigration(filePath: string, backup: string, preferred: string): void {
  try {
    copyMigrationPair(filePath, backup, preferred)
  } catch {
    secureRemove(backup)
    secureRemove(keyFilePath(backup))
    throw new Error('Pre-migration backup failed; migration was not started.')
  }
}

function finishMigrationCopy(input: { filePath: string; tmp: string; dataKey: Buffer; fromVersion: number; preferred: string }): void {
  const raw = openEncrypted(input.tmp, input.dataKey)
  try {
    raw.transaction(() => applyMigrations(raw, input.fromVersion, input.preferred))()
    raw.pragma('secure_delete = ON')
    raw.exec('VACUUM')
    raw.pragma('wal_checkpoint(TRUNCATE)')
  } finally {
    raw.close()
  }
  fsyncFile(input.tmp)
  fs.renameSync(input.tmp, input.filePath)
  fsyncDirectory(path.dirname(input.filePath))
  restrictPermissions(input.filePath)
  secureRemove(`${input.tmp}-wal`)
  secureRemove(`${input.tmp}-shm`)
}

export function migrateOnCopy(filePath: string, dataKey: Buffer, fromVersion: number): void {
  checkpointIfPending(filePath, dataKey)
  const backup = `${filePath}.v${fromVersion}.bak`
  const preferred = peekFileId(filePath, dataKey) ?? randomBytes(16).toString('hex')
  backupBeforeMigration(filePath, backup, preferred)
  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.migrating`)
  let migrated = false
  try {
    atomicCopyFile(filePath, tmp)
    finishMigrationCopy({ filePath, tmp, dataKey, fromVersion, preferred })
    migrated = true
    purgeBirthDateBackup(backup, dataKey)
  } catch (error) {
    if (!migrated) {
      removeMigrationTemp(tmp)
      throw new Error('Migration failed; the original file was left unchanged.')
    }
    throw error
  }
}

function backupHasBirthDate(backup: string, dataKey: Buffer): boolean {
  let raw: SqliteDatabase | undefined
  try {
    raw = new Database(backup, { readonly: true, fileMustExist: true })
    unlock(raw, dataKey)
    return columnNames(raw, 'person').has('birth_date')
  } catch {
    return false
  } finally {
    try { raw?.close() } catch { /* The handle may already be closed. */ }
    fs.rmSync(`${backup}-wal`, { force: true })
    fs.rmSync(`${backup}-shm`, { force: true })
  }
}

function purgeBirthDateBackup(backup: string, dataKey: Buffer): void {
  if (!fs.existsSync(backup) || !backupHasBirthDate(backup, dataKey)) return
  let raw: SqliteDatabase | undefined
  try {
    raw = openEncrypted(backup, dataKey)
    purgeBirthDateColumn(raw)
    raw.pragma('wal_checkpoint(TRUNCATE)')
    raw.close()
    raw = undefined
    restrictPermissions(backup)
    secureRemove(`${backup}-wal`)
    secureRemove(`${backup}-shm`)
  } catch {
    try { raw?.close() } catch { /* The handle may already be closed. */ }
    secureRemove(backup)
    secureRemove(`${backup}-wal`)
    secureRemove(`${backup}-shm`)
    secureRemove(keyFilePath(backup))
  }
}
