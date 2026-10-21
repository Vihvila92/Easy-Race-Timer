import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { EXPECTED_CIPHER, cipherSettings, plaintextSqliteFiles } from './cipher.js'
import { backupDatabase, openDataFile, openDatabase } from './db.js'
import { RaceFileError } from './errors.js'
import { devDataKey } from './key.js'
import { SCHEMA_VERSION } from './schema.js'

const dirs: string[] = []
const fixture = fileURLToPath(new URL('./kill-fixture.ts', import.meta.url))

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ert-cipher-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function modeOf(file: string): number {
  return fs.statSync(file).mode & 0o777
}

/** Plain SQLite, not SQLCipher. The sqlite3 CLI is preferred; CPython's sqlite3 is the same library. */
function assertPlainSqliteRejects(file: string): void {
  const cli = spawnSync('sqlite3', [file, 'SELECT count(*) FROM sqlite_master;'], { encoding: 'utf8' })
  if (!cli.error) {
    expect(cli.status).not.toBe(0)
    return
  }
  if ((cli.error as NodeJS.ErrnoException).code !== 'ENOENT') throw cli.error
  const py = spawnSync('python3', ['-c', [
    'import sqlite3, sys',
    'sqlite3.connect(sys.argv[1]).execute("select count(*) from sqlite_master")',
  ].join('\n'), file], { encoding: 'utf8' })
  expect(py.status).not.toBe(0)
}

function killDuring(modeName: string, dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', fixture, modeName, dir], {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    let stderr = ''
    let during: string[] | undefined
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    const started = Date.now()
    const timer = setInterval(() => {
      if (!fs.existsSync(path.join(dir, 'READY'))) {
        if (Date.now() - started > 20_000) {
          clearInterval(timer)
          child.kill('SIGKILL')
          reject(new Error(`fixture ${modeName} did not pause: ${stderr}`))
        }
        return
      }
      clearInterval(timer)
      during = plaintextSqliteFiles(dir)
      child.kill('SIGKILL')
    }, 30)
    child.on('exit', (code, signal) => {
      clearInterval(timer)
      if (during && during.length) {
        reject(new Error(`plaintext sqlite header during ${modeName}: ${during.join(', ')}`))
        return
      }
      if (signal === 'SIGKILL' || code === null) resolve()
      else reject(new Error(`fixture ${modeName} exited ${String(code)}: ${stderr}`))
    })
  })
}

describe('encrypted race file', () => {
  it('pins SQLCipher 4 settings and keeps accounts, consent, audit and race rows in that file', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'ert.sqlite')
    const db = await openDatabase(file)
    expect(cipherSettings(db.raw)).toEqual(EXPECTED_CIPHER)
    expect(String(db.raw.pragma('temp_store', { simple: true }))).toBe('2')
    const name = 'Maija Fixture'
    const email = 'maija.fixture@example.test'
    db.run(`INSERT INTO person (id, first_name, last_name, gender, birth_year, email, publication, created_at, updated_at, hlc)
      VALUES ('p1', 'Maija', 'Fixture', 'F', 1994, ?, 'full', 1, 1, '1')`, email)
    db.run(`INSERT INTO user_account (id, display_name, email, role, created_at, updated_at)
      VALUES ('u1', ?, ?, 'admin', 1, 1)`, name, email)
    db.run(`INSERT INTO key_slot (id, user_account_id, kind, kdf, created_at)
      VALUES ('k1', 'u1', 'admin', 'argon2id', 1)`)
    db.run(`INSERT INTO consent (id, person_id, purpose, granted, given_by, text_version, channel, recorded_at)
      VALUES ('c1', 'p1', 'long_term_storage', 1, 'self', 'retention-v1', 'desk', 1)`)
    db.run(`INSERT INTO correction (id, target_type, target_id, action, reason, hlc, created_at)
      VALUES ('a1', 'person', 'p1', 'note', ?, '1', 1)`, `audit ${email}`)
    db.raw.close()

    const bytes = fs.readFileSync(file)
    expect(bytes.includes(Buffer.from(name))).toBe(false)
    expect(bytes.includes(Buffer.from(email))).toBe(false)
    expect(bytes.includes(Buffer.from('Maija'))).toBe(false)
    expect(plaintextSqliteFiles(dir)).toEqual([])
    expect(modeOf(file)).toBe(0o600)

    const again = await openDatabase(file)
    expect(again.get('SELECT email FROM person WHERE id = ?', 'p1')).toEqual({ email })
    expect(again.get('SELECT email FROM user_account WHERE id = ?', 'u1')).toEqual({ email })
    expect(again.get('SELECT kind FROM key_slot WHERE id = ?', 'k1')).toEqual({ kind: 'admin' })
    expect(again.get('SELECT granted FROM consent WHERE id = ?', 'c1')).toEqual({ granted: 1 })
    expect(again.get<{ reason: string }>('SELECT reason FROM correction WHERE id = ?', 'a1')?.reason).toContain(email)
    again.raw.close()
  })

  it('refuses a backup and a pre-migration copy with plain sqlite3', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'ert.sqlite')
    const db = await openDatabase(file)
    db.run('UPDATE schema_meta SET schema_version = 3')
    db.run(`INSERT INTO event (id, org_id, name, date_start, timezone, sport, settings_json, created_at, updated_at, hlc)
      VALUES ('EV', 'local', 'Encrypted', '2027-06-12', 'Europe/Helsinki', 'run', '{}', 1, 1, '1')`)
    const usb = path.join(dir, 'usb', 'copy.sqlite')
    await backupDatabase(db, usb)
    db.raw.close()
    const before = fs.readFileSync(file)
    const migrated = await openDatabase(file)
    migrated.raw.close()
    const bakName = fs.readdirSync(dir).find((name) => name.endsWith('.v3.bak'))
    expect(bakName).toBeTruthy()
    const bak = path.join(dir, bakName!)
    expect(fs.readFileSync(bak).equals(before)).toBe(true)
    assertPlainSqliteRejects(usb)
    assertPlainSqliteRejects(bak)
    expect(modeOf(usb)).toBe(0o600)
    expect(modeOf(bak)).toBe(0o600)
    const opened = await openDataFile(usb, devDataKey())
    expect(opened.get<{ name: string }>('SELECT name FROM event')?.name).toBe('Encrypted')
    opened.raw.close()
  })

  it('returns one generic error for a wrong key and a tampered file', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'ert.sqlite')
    const db = await openDatabase(file)
    db.run(`INSERT INTO person (id, first_name, last_name, gender, birth_year, publication, created_at, updated_at, hlc)
      VALUES ('p1', 'Maija', 'Fixture', 'F', 1994, 'full', 1, 1, '1')`)
    db.raw.close()
    const wrongKey = Buffer.alloc(32, 0x22)
    const tampered = path.join(dir, 'tampered.sqlite')
    fs.copyFileSync(file, tampered)
    const flipped = fs.readFileSync(tampered)
    flipped[80] ^= 0xff
    fs.writeFileSync(tampered, flipped)

    const wrong = await openDatabase(file, { dataKey: wrongKey }).then(() => null, (error: unknown) => error)
    const damaged = await openDatabase(tampered, { dataKey: devDataKey() }).then(() => null, (error: unknown) => error)
    expect(wrong).toBeInstanceOf(RaceFileError)
    expect(damaged).toBeInstanceOf(RaceFileError)
    const wrongError = wrong as RaceFileError
    const damagedError = damaged as RaceFileError
    expect(wrongError.message).toBe('Could not open race file ert.sqlite.')
    expect(damagedError.message).toBe(wrongError.message.replace('ert.sqlite', 'tampered.sqlite'))
    expect(wrongError.message).toBe(damagedError.message.replace('tampered.sqlite', 'ert.sqlite'))
    for (const error of [wrongError, damagedError]) {
      expect(error.message).not.toContain(dir)
      expect(error.message).not.toContain(wrongKey.toString('hex'))
      expect(error.stack ?? '').not.toContain(dir)
      expect(error.stack ?? '').not.toMatch(/\n\s+at /)
    }
  })

  it('refuses the dev key provider in production', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'ert.sqlite')
    expect(() => devDataKey({ NODE_ENV: 'production' })).toThrow(/disabled in production/)
    expect(() => devDataKey({ NODE_ENV: 'production', ERT_ALLOW_DEV_KEY: '1' })).toThrow(/disabled in production/)
    await expect(openDatabase(file, { env: { NODE_ENV: 'production' } })).rejects.toThrow(/disabled in production/)
    await expect(openDatabase(file, { env: { NODE_ENV: 'production', ERT_ALLOW_DEV_KEY: '1' }, dataKey: devDataKey() })).rejects.toThrow(/disabled in production/)
    const db = await openDatabase(file, { env: { NODE_ENV: 'production' }, dataKey: Buffer.alloc(32, 0x22) })
    expect(db.get<{ schema_version: number }>('SELECT schema_version FROM schema_meta WHERE id = 1')?.schema_version).toBe(SCHEMA_VERSION)
    db.raw.close()
  })

  it('stores birth year only, requires consent_date, and keeps the DSQ reason internal', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'ert.sqlite')
    const db = await openDatabase(file)
    const personColumns = db.all<{ name: string }>('PRAGMA table_info(person)').map((column) => column.name)
    expect(personColumns).not.toContain('birth_date')
    expect(personColumns).toContain('birth_year')
    const consent = db.all<{ name: string; notnull: number }>('PRAGMA table_info(entry)').find((column) => column.name === 'consent_date')
    expect(consent?.notnull).toBe(1)
    expect(() => db.run(`INSERT INTO entry (id, race_id, registered_at, reg_seq, created_at, updated_at, hlc)
      VALUES ('e1', 'R1', 1, 1, 1, 1, '1')`)).toThrow()
    db.run(`INSERT INTO entry (id, race_id, registered_at, reg_seq, created_at, updated_at, hlc, consent_date, dsq_reason, status)
      VALUES ('e1', 'R1', 1, 1, 1, 1, '1', '2027-06-12', 'internal-dq-note', 'dsq')`)
    const snap = JSON.stringify(db.snapshot())
    expect(snap).not.toContain('internal-dq-note')
    expect(snap).not.toContain('dsq_reason')
    db.raw.close()
    expect(fs.readFileSync(file).includes(Buffer.from('2014-08-09'))).toBe(false)
  })

  it('drops a stored birth date when migrating an older file', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'ert.sqlite')
    const db = await openDatabase(file)
    db.run('ALTER TABLE person ADD COLUMN birth_date TEXT')
    db.run(`INSERT INTO person (id, first_name, last_name, gender, birth_date, birth_year, publication, created_at, updated_at, hlc)
      VALUES ('p1', 'Aino', 'Testi', 'F', '2014-08-09', NULL, 'full', 1, 1, '1')`)
    db.run('ALTER TABLE entry DROP COLUMN consent_date')
    db.run('ALTER TABLE entry DROP COLUMN dsq_reason')
    db.run('UPDATE schema_meta SET schema_version = 3')
    db.raw.close()
    const migrated = await openDatabase(file)
    const columns = migrated.all<{ name: string }>('PRAGMA table_info(person)').map((column) => column.name)
    expect(columns).not.toContain('birth_date')
    expect(migrated.get('SELECT birth_year FROM person WHERE id = ?', 'p1')).toEqual({ birth_year: 2014 })
    const entryColumns = migrated.all<{ name: string; notnull: number }>('PRAGMA table_info(entry)')
    expect(entryColumns.find((column) => column.name === 'consent_date')?.notnull).toBe(1)
    expect(entryColumns.some((column) => column.name === 'dsq_reason')).toBe(true)
    migrated.raw.close()
    expect(fs.readFileSync(file).includes(Buffer.from('2014-08-09'))).toBe(false)
    expect(plaintextSqliteFiles(dir)).toEqual([])
  })

  it('shows a friendly error for a newer schema', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'nested', 'ert.sqlite')
    const db = await openDatabase(file)
    db.run('UPDATE schema_meta SET schema_version = ?', SCHEMA_VERSION + 1)
    db.raw.close()
    const error = await openDatabase(file).then(() => null, (caught: unknown) => caught)
    expect(error).toBeInstanceOf(RaceFileError)
    const raceFile = error as RaceFileError
    expect(raceFile.kind).toBe('newer')
    expect(raceFile.fileName).toBe('ert.sqlite')
    expect(raceFile.message).not.toContain(dir)
    expect(raceFile.stack ?? '').not.toContain(dir)
  })
})

describe('power loss', () => {
  it('kills a migration and still opens either the original or the migrated file', async () => {
    const dir = tempDir()
    await killDuring('migrate', dir)
    expect(plaintextSqliteFiles(dir)).toEqual([])
    const file = path.join(dir, 'ert.sqlite')
    const db = await openDatabase(file)
    expect(db.raw.pragma('integrity_check', { simple: true })).toBe('ok')
    const version = db.get<{ schema_version: number }>('SELECT schema_version FROM schema_meta WHERE id = 1')?.schema_version
    expect(version === 3 || version === SCHEMA_VERSION).toBe(true)
    expect(db.get<{ email: string }>('SELECT email FROM person WHERE id = ?', 'kept')?.email).toBe('kept@example.test')
    if (version === SCHEMA_VERSION) {
      expect(db.all<{ name: string }>('PRAGMA table_info(person)').some((column) => column.name === 'birth_date')).toBe(false)
    }
    db.raw.close()
  })

  it('keeps the last committed row when a save is killed', async () => {
    const dir = tempDir()
    await killDuring('save', dir)
    const file = path.join(dir, 'ert.sqlite')
    const db = await openDatabase(file)
    expect(db.raw.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(db.get('SELECT id FROM person WHERE id = ?', 'kept')).toEqual({ id: 'kept' })
    expect(db.get('SELECT id FROM person WHERE id = ?', 'lost')).toBeUndefined()
    db.raw.close()
    expect(plaintextSqliteFiles(dir)).toEqual([])
  })
})
