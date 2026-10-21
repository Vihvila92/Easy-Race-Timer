import Database from 'better-sqlite3-multiple-ciphers'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EXPECTED_CIPHER, cipherSettings, isPlaintextSqlite, plaintextSqliteFiles, rawKeyPragma } from './cipher.js'
import { backupDatabase, openDataFile, openDatabase, plaintextHooks, rekeyDataFile, rekeyHooks } from './db.js'
import { RaceFileError } from './errors.js'
import { devDataKey, resetDevKeyWarning } from './key.js'
import { SCHEMA_VERSION } from './schema.js'

const dirs: string[] = []
const fixture = fileURLToPath(new URL('./kill-fixture.ts', import.meta.url))

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ert-cipher-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  rekeyHooks.beforeRename = undefined
  plaintextHooks.failAfter = undefined
  plaintextHooks.pauseAfter = undefined
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function modeOf(file: string): number {
  return fs.statSync(file).mode & 0o777
}

/** Names in the shared temp directory that are peek files or byte-identical copies of `bytes`. */
function tmpPlaintextCopies(bytes: Buffer): string[] {
  const found: string[] = []
  for (const name of fs.readdirSync(os.tmpdir())) {
    if (name.startsWith('ert-peek-')) found.push(name)
    const full = path.join(os.tmpdir(), name)
    let stat: fs.Stats
    try {
      stat = fs.lstatSync(full)
    } catch {
      continue
    }
    if (!stat.isFile() || stat.size !== bytes.length) continue
    try {
      if (fs.readFileSync(full).equals(bytes)) found.push(name)
    } catch {
      // The file may disappear while the directory is scanned.
    }
  }
  return found
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

function killChild(modeName: string, dir: string, rejectPlaintext: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', fixture, modeName, dir], {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test', ERT_DEV_KEY: '1' },
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
      if (rejectPlaintext) during = plaintextSqliteFiles(dir)
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

function killDuring(modeName: string, dir: string): Promise<void> {
  return killChild(modeName, dir, true)
}

describe('encrypted race file', () => {
  it('builds the raw key pragma from the buffer hex only', () => {
    const dataKey = Buffer.alloc(32, 0x22)
    const hex = dataKey.toString('hex')
    expect(rawKeyPragma('key', dataKey)).toBe(`key = "x'${hex}'"`)
    expect(rawKeyPragma('rekey', dataKey)).toBe(`rekey = "x'${hex}'"`)
    expect(hex).toMatch(/^[0-9a-f]{64}$/)
    dataKey.fill(0)
  })

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
    expect(db.get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'key_slot'`)).toBeUndefined()
    const fileId = db.get<{ file_id: string }>('SELECT file_id FROM schema_meta WHERE id = 1')?.file_id
    expect(fileId).toMatch(/^[0-9a-f]{32}$/)
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
    expect(again.get<{ file_id: string }>('SELECT file_id FROM schema_meta WHERE id = 1')?.file_id).toBe(fileId)
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
    expect(() => devDataKey({ NODE_ENV: 'production', ERT_DEV_KEY: '1' })).toThrow(/disabled in production/)
    await expect(openDatabase(file, { env: { NODE_ENV: 'production' } })).rejects.toThrow(/disabled in production/)
    await expect(openDatabase(file, { env: { NODE_ENV: 'production', ERT_DEV_KEY: '1' } })).rejects.toThrow(/disabled in production/)
    await expect(openDatabase(file, { env: { NODE_ENV: 'production', ERT_ALLOW_DEV_KEY: '1' }, dataKey: devDataKey() })).rejects.toThrow(/disabled in production/)
    await expect(openDatabase(file, { env: {} })).rejects.toThrow(/No data key is configured/)
    await expect(openDatabase(file, { env: { NODE_ENV: '' } })).rejects.toThrow(/No data key is configured/)
    await expect(openDatabase(file, { env: { NODE_ENV: 'test' } })).rejects.toThrow(/No data key is configured/)
    await expect(openDatabase(file, { env: { NODE_ENV: 'development' } })).rejects.toThrow(/No data key is configured/)
    const published = devDataKey()
    await expect(openDatabase(file, { env: { NODE_ENV: 'test' }, dataKey: published })).rejects.toThrow(/No data key is configured/)
    resetDevKeyWarning()
    const warnings: string[] = []
    const spy = vi.spyOn(console, 'warn').mockImplementation((message: unknown) => {
      warnings.push(String(message))
    })
    const db = await openDatabase(file, { env: { NODE_ENV: 'development', ERT_DEV_KEY: '1' } })
    expect(warnings.some((line) => line.includes('ERT_DEV_KEY is in use'))).toBe(true)
    spy.mockRestore()
    expect(db.get<{ schema_version: number }>('SELECT schema_version FROM schema_meta WHERE id = 1')?.schema_version).toBe(SCHEMA_VERSION)
    const key = db.dataKey
    expect(key?.equals(published)).toBe(true)
    db.raw.close()
    expect(key?.every((byte) => byte === 0)).toBe(true)
    const production = await openDatabase(path.join(dir, 'production.sqlite'), { env: { NODE_ENV: 'production' }, dataKey: Buffer.alloc(32, 0x22) })
    expect(production.get<{ schema_version: number }>('SELECT schema_version FROM schema_meta WHERE id = 1')?.schema_version).toBe(SCHEMA_VERSION)
    production.raw.close()
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
    migrated.raw.pragma('wal_checkpoint(TRUNCATE)')
    expect(migrated.raw.pragma('freelist_count', { simple: true })).toBe(0)
    expect(Number(migrated.raw.pragma('secure_delete', { simple: true }))).toBe(1)
    expect(migrated.raw.serialize().includes(Buffer.from('2014-08-09'))).toBe(false)
    migrated.raw.close()
    const bakName = fs.readdirSync(dir).find((name) => name.endsWith('.v3.bak'))
    expect(bakName).toBeTruthy()
    const bak = await openDataFile(path.join(dir, bakName!), devDataKey())
    bak.raw.pragma('wal_checkpoint(TRUNCATE)')
    expect(bak.raw.pragma('freelist_count', { simple: true })).toBe(0)
    expect(bak.all<{ name: string }>('PRAGMA table_info(person)').some((column) => column.name === 'birth_date')).toBe(false)
    expect(bak.raw.serialize().includes(Buffer.from('2014-08-09'))).toBe(false)
    bak.raw.close()
    expect(fs.readFileSync(file).includes(Buffer.from('2014-08-09'))).toBe(false)
    expect(plaintextSqliteFiles(dir)).toEqual([])
  })

  it('rotates the data key out of WAL mode and rejects the previous key', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'ert.sqlite')
    const db = await openDatabase(file)
    db.run(`INSERT INTO person (id, first_name, last_name, gender, birth_year, publication, created_at, updated_at, hlc)
      VALUES ('p1', 'Aino', 'Testi', 'F', 2014, 'full', 1, 1, '1')`)
    const previous = Buffer.from(db.dataKey!)
    const next = Buffer.alloc(32, 0x44)
    const fileId = db.get<{ file_id: string }>('SELECT file_id FROM schema_meta WHERE id = 1')?.file_id
    rekeyDataFile(db, next)
    expect(db.get<{ file_id: string }>('SELECT file_id FROM schema_meta WHERE id = 1')?.file_id).toBe(fileId)
    expect(db.raw.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(db.raw.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(db.dataKey?.equals(next)).toBe(true)
    db.raw.close()
    await expect(openDatabase(file, { dataKey: previous })).rejects.toBeInstanceOf(RaceFileError)
    const opened = await openDatabase(file, { dataKey: next })
    expect(opened.get('SELECT birth_year FROM person WHERE id = ?', 'p1')).toEqual({ birth_year: 2014 })
    expect(opened.get<{ file_id: string }>('SELECT file_id FROM schema_meta WHERE id = 1')?.file_id).toBe(fileId)
    expect(opened.raw.pragma('integrity_check', { simple: true })).toBe('ok')
    const stub = fs.readFileSync(path.join(dir, 'ert.keys'))
    expect(stub.subarray(0, 4).toString('utf8')).toBe('ERTS')
    expect(stub.includes(next)).toBe(false)
    expect(stub.toString('utf8').includes(next.toString('hex'))).toBe(false)
    opened.raw.close()
    previous.fill(0)
    next.fill(0)
  })

  it('keeps the original pair when rekey stops before rename', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'ert.sqlite')
    const db = await openDatabase(file)
    db.run(`INSERT INTO person (id, first_name, last_name, gender, birth_year, publication, created_at, updated_at, hlc)
      VALUES ('p1', 'Aino', 'Testi', 'F', 2014, 'full', 1, 1, '1')`)
    const previous = Buffer.from(db.dataKey!)
    const fileId = db.get<{ file_id: string }>('SELECT file_id FROM schema_meta WHERE id = 1')?.file_id
    rekeyHooks.beforeRename = () => {
      throw new Error('stop')
    }
    expect(() => rekeyDataFile(db, Buffer.alloc(32, 0x44))).toThrow(/Rekey failed/)
    expect(db.raw.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(db.get<{ file_id: string }>('SELECT file_id FROM schema_meta WHERE id = 1')?.file_id).toBe(fileId)
    expect(fs.readdirSync(dir).some((name) => name.includes('.rekey'))).toBe(false)
    db.raw.close()
    const opened = await openDatabase(file, { dataKey: previous })
    expect(opened.get('SELECT birth_year FROM person WHERE id = ?', 'p1')).toEqual({ birth_year: 2014 })
    opened.raw.close()
    previous.fill(0)
  })

  it('encrypts a plaintext race file and quarantines only recognized copies', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'ert.sqlite')
    const plain = new Database(file)
    plain.exec(`CREATE TABLE schema_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      schema_version INTEGER NOT NULL,
      app_version TEXT NOT NULL,
      installation_id TEXT NOT NULL
    )`)
    plain.prepare('INSERT INTO schema_meta (id, schema_version, app_version, installation_id) VALUES (1, 3, ?, ?)').run('0.1.0', 'install')
    plain.exec(`CREATE TABLE person (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      gender TEXT NOT NULL,
      birth_date TEXT,
      birth_year INTEGER,
      publication TEXT NOT NULL DEFAULT 'full',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      hlc TEXT NOT NULL
    )`)
    plain.prepare(`INSERT INTO person (id, first_name, last_name, gender, birth_date, birth_year, publication, created_at, updated_at, hlc)
      VALUES ('p1', 'Aino', 'Testi', 'F', '2014-08-09', NULL, 'full', 1, 1, '1')`).run()
    plain.exec(`CREATE TABLE entry (
      id TEXT PRIMARY KEY,
      race_id TEXT,
      person_id TEXT,
      bib INTEGER,
      registered_at INTEGER
    )`)
    plain.exec('CREATE TABLE audit_shadow (id INTEGER)')
    plain.exec('CREATE TRIGGER person_ins AFTER INSERT ON person BEGIN INSERT INTO audit_shadow (id) VALUES (1); END')
    plain.exec('CREATE INDEX idx_person_name ON person(last_name)')
    plain.exec('CREATE VIEW person_names AS SELECT id, first_name, last_name FROM person')
    plain.close()
    const backups = path.join(dir, 'backups')
    fs.mkdirSync(backups)
    const notes = new Database(path.join(dir, 'notes.sqlite'))
    notes.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)')
    notes.prepare('INSERT INTO notes (body) VALUES (?)').run('foreign')
    notes.exec(`CREATE TABLE schema_meta (id INTEGER PRIMARY KEY, schema_version INTEGER)`)
    notes.close()
    fs.copyFileSync(path.join(dir, 'notes.sqlite'), path.join(backups, 'notes.sqlite'))
    fs.copyFileSync(file, path.join(dir, 'ert-legacy.sqlite'))
    fs.copyFileSync(file, path.join(backups, 'ert-old-lock.sqlite'))
    fs.copyFileSync(file, path.join(dir, 'race.premigrate-1.sqlite'))
    const foreign = new Database(path.join(dir, 'ert-foreign.sqlite'))
    foreign.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)')
    foreign.prepare('INSERT INTO notes (body) VALUES (?)').run('not ours')
    foreign.close()
    const untouched = [
      path.join(dir, 'notes.sqlite'),
      path.join(backups, 'notes.sqlite'),
      path.join(dir, 'ert-foreign.sqlite'),
    ].map((candidate) => ({ file: candidate, bytes: fs.readFileSync(candidate), mtime: fs.statSync(candidate).mtimeMs }))
    const legacyBytes = fs.readFileSync(path.join(dir, 'ert-legacy.sqlite'))
    const tmpBefore = new Set(tmpPlaintextCopies(legacyBytes))
    const warnings: string[] = []
    const spy = vi.spyOn(console, 'warn').mockImplementation((message: unknown) => {
      warnings.push(String(message))
    })
    const db = await openDatabase(file)
    spy.mockRestore()
    expect(db.all<{ name: string }>('PRAGMA table_info(person)').some((column) => column.name === 'birth_date')).toBe(false)
    expect(db.get('SELECT birth_year FROM person WHERE id = ?', 'p1')).toEqual({ birth_year: 2014 })
    expect(db.get(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_person_name'`)).toEqual({ name: 'idx_person_name' })
    expect(db.get(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'person_ins'`)).toEqual({ name: 'person_ins' })
    expect(db.get(`SELECT name FROM sqlite_master WHERE type = 'view' AND name = 'person_names'`)).toEqual({ name: 'person_names' })
    expect(db.get('SELECT last_name FROM person_names WHERE id = ?', 'p1')).toEqual({ last_name: 'Testi' })
    db.run(`INSERT INTO person (id, first_name, last_name, gender, birth_year, publication, created_at, updated_at, hlc)
      VALUES ('p2', 'Extra', 'Runner', 'M', 1990, 'full', 2, 2, '2')`)
    expect(db.get('SELECT COUNT(*) AS n FROM audit_shadow')).toEqual({ n: 1 })
    db.raw.pragma('wal_checkpoint(TRUNCATE)')
    expect(db.raw.serialize().includes(Buffer.from('2014-08-09'))).toBe(false)
    expect(db.quarantinedPlaintext.slice().sort()).toEqual(['ert-legacy.sqlite', 'ert-old-lock.sqlite', 'race.premigrate-1.sqlite'])
    db.raw.close()
    expect(fs.readFileSync(file).subarray(0, 16).toString('utf8')).not.toContain('SQLite format 3')
    expect(fs.existsSync(`${file}.plaintext-old`)).toBe(false)
    expect(fs.existsSync(`${file}.encrypting`)).toBe(false)
    const quarantine = path.join(dir, 'plaintext-quarantine')
    expect(modeOf(quarantine)).toBe(0o700)
    for (const name of ['ert-legacy.sqlite', 'ert-old-lock.sqlite', 'race.premigrate-1.sqlite']) {
      expect(fs.existsSync(path.join(quarantine, name))).toBe(true)
      expect(isPlaintextSqlite(path.join(quarantine, name))).toBe(true)
    }
    for (const saved of untouched) {
      expect(fs.readFileSync(saved.file).equals(saved.bytes)).toBe(true)
      expect(fs.statSync(saved.file).mtimeMs).toBe(saved.mtime)
    }
    expect(plaintextSqliteFiles(dir).sort()).toEqual(['ert-foreign.sqlite', 'notes.sqlite'])
    expect(plaintextSqliteFiles(backups)).toEqual(['notes.sqlite'])
    const text = warnings.join('\n')
    expect(text).toContain('Encrypted plaintext race file ert.sqlite')
    expect(text).toContain('overwritten where the filesystem allows')
    expect(text).toContain('Quarantined plaintext race file ert-legacy.sqlite')
    expect(text).toContain('Quarantined plaintext race file ert-old-lock.sqlite')
    expect(text).toContain('Quarantined plaintext race file race.premigrate-1.sqlite')
    expect(text).not.toContain('Removed plaintext')
    expect(text).not.toContain('notes.sqlite')
    expect(text).not.toContain(dir)
    expect(fs.readdirSync(os.tmpdir()).some((name) => name.startsWith('ert-peek-'))).toBe(false)
    expect(tmpPlaintextCopies(legacyBytes).filter((name) => !tmpBefore.has(name))).toEqual([])
  })

  it('does not follow a symlink named like a race file', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'ert.sqlite')
    const plain = new Database(file)
    plain.exec(`CREATE TABLE schema_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      schema_version INTEGER NOT NULL,
      app_version TEXT NOT NULL,
      installation_id TEXT NOT NULL
    )`)
    plain.prepare('INSERT INTO schema_meta (id, schema_version, app_version, installation_id) VALUES (1, 4, ?, ?)').run('0.1.0', 'install')
    plain.close()
    const notes = path.join(dir, 'notes.sqlite')
    fs.copyFileSync(file, notes)
    const notesBytes = fs.readFileSync(notes)
    fs.symlinkSync(notes, path.join(dir, 'ert-linked.sqlite'))
    const elsewhere = path.join(dir, 'elsewhere')
    fs.mkdirSync(elsewhere)
    fs.copyFileSync(file, path.join(elsewhere, 'ert-hidden.sqlite'))
    const hiddenBytes = fs.readFileSync(path.join(elsewhere, 'ert-hidden.sqlite'))
    fs.symlinkSync(elsewhere, path.join(dir, 'backups'))
    const db = await openDatabase(file)
    db.raw.close()
    expect(fs.lstatSync(path.join(dir, 'ert-linked.sqlite')).isSymbolicLink()).toBe(true)
    expect(fs.readlinkSync(path.join(dir, 'ert-linked.sqlite'))).toBe(notes)
    expect(fs.readFileSync(notes).equals(notesBytes)).toBe(true)
    expect(fs.lstatSync(path.join(dir, 'backups')).isSymbolicLink()).toBe(true)
    expect(fs.readFileSync(path.join(elsewhere, 'ert-hidden.sqlite')).equals(hiddenBytes)).toBe(true)
    expect(fs.existsSync(path.join(dir, 'plaintext-quarantine', 'ert-linked.sqlite'))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'plaintext-quarantine', 'ert-hidden.sqlite'))).toBe(false)
  })

  it('keeps race rows when plaintext encryption stops after each durable step', async () => {
    const steps = ['encrypting', 'aside', 'renamed'] as const
    for (const step of steps) {
      const dir = tempDir()
      const file = path.join(dir, 'ert.sqlite')
      const plain = new Database(file)
      plain.exec(`CREATE TABLE schema_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        schema_version INTEGER NOT NULL,
        app_version TEXT NOT NULL,
        installation_id TEXT NOT NULL
      )`)
      plain.prepare('INSERT INTO schema_meta (id, schema_version, app_version, installation_id) VALUES (1, 4, ?, ?)').run('0.1.0', 'install')
      plain.exec(`CREATE TABLE person (
        id TEXT PRIMARY KEY,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        gender TEXT NOT NULL,
        birth_year INTEGER,
        email TEXT,
        publication TEXT NOT NULL DEFAULT 'full',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        hlc TEXT NOT NULL
      )`)
      plain.prepare(`INSERT INTO person (id, first_name, last_name, gender, birth_year, email, publication, created_at, updated_at, hlc)
        VALUES ('kept', 'Kept', 'Runner', 'F', 1991, 'kept@example.test', 'full', 1, 1, '1')`).run()
      plain.close()
      plaintextHooks.failAfter = step
      await expect(openDatabase(file)).rejects.toThrow(new RegExp(`paused after ${step}`))
      plaintextHooks.failAfter = undefined
      if (step === 'encrypting') {
        expect(isPlaintextSqlite(file)).toBe(true)
        expect(fs.existsSync(`${file}.encrypting`)).toBe(true)
        expect(fs.existsSync(`${file}.plaintext-old`)).toBe(false)
      } else if (step === 'aside') {
        expect(fs.existsSync(file)).toBe(false)
        expect(isPlaintextSqlite(`${file}.plaintext-old`)).toBe(true)
        expect(fs.existsSync(`${file}.encrypting`)).toBe(true)
        const aside = new Database(`${file}.plaintext-old`)
        aside.prepare(`UPDATE person SET email = ? WHERE id = 'kept'`).run('restored@example.test')
        aside.close()
      } else {
        expect(isPlaintextSqlite(file)).toBe(false)
        expect(isPlaintextSqlite(`${file}.plaintext-old`)).toBe(true)
        expect(fs.existsSync(`${file}.encrypting`)).toBe(false)
        const aside = new Database(`${file}.plaintext-old`)
        aside.prepare(`UPDATE person SET email = ? WHERE id = 'kept'`).run('restored@example.test')
        aside.close()
        const fd = fs.openSync(file, 'r+')
        fs.writeSync(fd, Buffer.alloc(32, 0x5a), 0)
        fs.closeSync(fd)
      }
      const db = await openDatabase(file)
      expect(db.raw.pragma('integrity_check', { simple: true })).toBe('ok')
      expect(db.get<{ email: string }>('SELECT email FROM person WHERE id = ?', 'kept')?.email).toBe(step === 'encrypting' ? 'kept@example.test' : 'restored@example.test')
      db.raw.close()
      expect(fs.existsSync(`${file}.plaintext-old`)).toBe(false)
      expect(fs.existsSync(`${file}.encrypting`)).toBe(false)
    }
  })

  it('promotes a leftover encrypting copy when the race file is missing', async () => {
    for (const leftover of ['ert.sqlite.encrypting', '.ert.sqlite.encrypting']) {
      const dir = tempDir()
      const file = path.join(dir, 'ert.sqlite')
      const db = await openDatabase(file)
      db.run(`INSERT INTO person (id, first_name, last_name, gender, birth_year, email, publication, created_at, updated_at, hlc)
        VALUES ('kept', 'Kept', 'Runner', 'F', 1991, 'kept@example.test', 'full', 1, 1, '1')`)
      db.raw.pragma('wal_checkpoint(TRUNCATE)')
      db.raw.close()
      fs.renameSync(file, path.join(dir, leftover))
      const again = await openDatabase(file)
      expect(again.get<{ email: string }>('SELECT email FROM person WHERE id = ?', 'kept')?.email).toBe('kept@example.test')
      expect(fs.existsSync(path.join(dir, leftover))).toBe(false)
      expect(isPlaintextSqlite(file)).toBe(false)
      again.raw.close()
    }
  })

  it('does not replace a broken encrypting leftover with an empty database', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'ert.sqlite')
    fs.writeFileSync(`${file}.encrypting`, Buffer.from('not a database, and not empty'))
    const error = await openDatabase(file).then(() => null, (caught: unknown) => caught)
    expect(error).toBeInstanceOf(RaceFileError)
    const raceFile = error as RaceFileError
    expect(raceFile.kind).toBe('open')
    expect(raceFile.fileName).toBe('ert.sqlite')
    expect(raceFile.message).not.toContain(dir)
    expect(raceFile.message).not.toContain('could not be recovered')
    expect(fs.existsSync(file)).toBe(false)
    expect(fs.readFileSync(`${file}.encrypting`).toString('utf8')).toContain('not a database')
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

  it('recovers the race file after a kill at each plaintext encryption step', async () => {
    for (const step of ['encrypt-encrypting', 'encrypt-aside', 'encrypt-renamed'] as const) {
      const dir = tempDir()
      const file = path.join(dir, 'ert.sqlite')
      await killChild(step, dir, false)
      if (step === 'encrypt-encrypting') {
        expect(isPlaintextSqlite(file)).toBe(true)
        expect(fs.existsSync(`${file}.encrypting`)).toBe(true)
      } else if (step === 'encrypt-aside') {
        expect(fs.existsSync(file)).toBe(false)
        expect(isPlaintextSqlite(`${file}.plaintext-old`)).toBe(true)
        expect(fs.existsSync(`${file}.encrypting`)).toBe(true)
      } else {
        expect(isPlaintextSqlite(file)).toBe(false)
        expect(isPlaintextSqlite(`${file}.plaintext-old`)).toBe(true)
      }
      const db = await openDatabase(file)
      expect(db.raw.pragma('integrity_check', { simple: true })).toBe('ok')
      expect(db.get<{ email: string }>('SELECT email FROM person WHERE id = ?', 'kept')?.email).toBe('kept@example.test')
      db.raw.close()
      expect(fs.existsSync(`${file}.plaintext-old`)).toBe(false)
      expect(plaintextSqliteFiles(dir)).toEqual([])
    }
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
