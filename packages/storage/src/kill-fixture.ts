/**
 * Child process for power-loss tests. The parent sends SIGKILL while this process waits.
 * Usage: node --import tsx packages/storage/src/kill-fixture.ts <migrate|save> <directory>
 */
import fs from 'node:fs'
import path from 'node:path'
import { migrationHooks, openDatabase } from './db.js'

function pause(dir: string): void {
  fs.writeFileSync(path.join(dir, 'READY'), '1')
  const gate = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(gate, 0, 0, 30_000)
}

const mode = process.argv[2]
const dir = process.argv[3]
if (!mode || !dir) {
  process.stderr.write('usage: kill-fixture.ts <migrate|save> <directory>\n')
  process.exit(2)
}

const file = path.join(dir, 'ert.sqlite')

if (mode === 'migrate') {
  const db = await openDatabase(file)
  db.run(`INSERT INTO person (id, first_name, last_name, gender, birth_year, email, publication, created_at, updated_at, hlc)
    VALUES ('kept', 'Kept', 'Runner', 'F', 1991, 'kept@example.test', 'full', 1, 1, '1')`)
  db.run('UPDATE schema_meta SET schema_version = 3')
  db.raw.close()
  migrationHooks.beforeCommit = () => pause(dir)
  await openDatabase(file)
} else if (mode === 'save') {
  const db = await openDatabase(file)
  db.run(`INSERT INTO person (id, first_name, last_name, gender, birth_year, email, publication, created_at, updated_at, hlc)
    VALUES ('kept', 'Kept', 'Runner', 'F', 1991, 'kept@example.test', 'full', 1, 1, '1')`)
  db.raw.exec('BEGIN IMMEDIATE')
  db.run(`INSERT INTO person (id, first_name, last_name, gender, birth_year, email, publication, created_at, updated_at, hlc)
    VALUES ('lost', 'Lost', 'Runner', 'M', 1992, 'lost@example.test', 'full', 2, 2, '2')`)
  pause(dir)
  db.raw.exec('COMMIT')
  db.raw.close()
} else {
  process.stderr.write('unknown mode\n')
  process.exit(2)
}
