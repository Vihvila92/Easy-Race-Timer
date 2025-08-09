#!/usr/bin/env ts-node
/* Simple migration runner */
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getPool } from './lib/db';

interface MigrationFile { order: number; name: string; file: string; checksum?: string; }

const defaultMigrationsDir = path.join(process.cwd(), '..', 'database', 'schema', 'migrations');
const migrationsDir = process.env.MIGRATIONS_DIR || defaultMigrationsDir;

async function ensureTable() {
  const pool = getPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id BIGSERIAL PRIMARY KEY,
    version BIGINT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    checksum TEXT,
    run_at TIMESTAMPTZ DEFAULT now()
  );`);
  // Add checksum column if table existed without it
  const { rows } = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='schema_migrations' AND column_name='checksum'`);
  if (rows.length === 0) {
    await pool.query('ALTER TABLE schema_migrations ADD COLUMN checksum TEXT');
  }
}

async function listMigrations(): Promise<MigrationFile[]> {
  const files = await fs.readdir(migrationsDir);
  return (files as string[])
  .filter((f: string) => /^(\d+)_.*\.sql$/.test(f) && !f.endsWith('.down.sql'))
    .map((f: string) => {
      const match = f.match(/^(\d+)_([^.]*)\.sql$/)!;
      return { order: parseInt(match[1], 10), name: match[2], file: path.join(migrationsDir, f) };
    })
    .sort((a: MigrationFile, b: MigrationFile) => a.order - b.order);
}

interface AppliedRow { version: number; name: string; checksum: string | null }
async function appliedMap(): Promise<Map<number, AppliedRow>> {
  const pool = getPool();
  const { rows } = await pool.query('SELECT version, name, checksum FROM schema_migrations');
  const map = new Map<number, AppliedRow>();
  rows.forEach((r: any) => map.set(Number(r.version), { version: Number(r.version), name: r.name, checksum: r.checksum }));
  return map;
}

function fileChecksum(content: string) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function acquireLock(): Promise<boolean> {
  const pool = getPool();
  // Derive a deterministic big int lock key (hash truncated) from project name
  const key = BigInt('0x' + crypto.createHash('sha1').update('easy-race-timer-schema-lock').digest('hex').slice(0, 15));
  const { rows } = await pool.query('SELECT pg_try_advisory_lock($1)::boolean AS locked', [key.toString()]);
  return rows[0].locked;
}

async function releaseLock() {
  const pool = getPool();
  const key = BigInt('0x' + crypto.createHash('sha1').update('easy-race-timer-schema-lock').digest('hex').slice(0, 15));
  await pool.query('SELECT pg_advisory_unlock($1)', [key.toString()]);
}

async function migrateUp() {
  await ensureTable();
  // Backfill any missing checksums before proceeding so drift detection works for future changes.
  await backfillChecksums({ quiet: true });
  if (!(await acquireLock())) {
    console.error('Could not acquire advisory lock. Another migration process may be running.');
    process.exit(2);
  }
  const startAll = Date.now();
  try {
    const all = await listMigrations();
    const applied = await appliedMap();
    const pool = getPool();
    for (const m of all) {
      if (!applied.has(m.order)) {
        const sql = await fs.readFile(m.file, 'utf8');
        const checksum = fileChecksum(sql);
        console.log(`→ Applying migration ${m.order} - ${m.name}`);
        const t0 = Date.now();
        await pool.query('BEGIN');
        try {
          await pool.query(sql);
          await pool.query('INSERT INTO schema_migrations(version, name, checksum) VALUES ($1,$2,$3)', [m.order, m.name, checksum]);
          await pool.query('COMMIT');
          const dt = Date.now() - t0;
          console.log(`✓ ${m.order} (${dt}ms)`);
        } catch (e) {
          await pool.query('ROLLBACK');
          console.error(`✗ Migration failed ${m.order} - ${m.name}`);
          console.error(e);
          process.exit(1);
        }
      }
    }
    console.log(`All migrations complete in ${Date.now() - startAll}ms`);
  } finally {
    await releaseLock().catch(()=>{});
  }
}

async function status() {
  await ensureTable();
  // Do not auto-backfill here; we want user visibility. Use 'backfill' command to persist.
  const applied = await appliedMap();
  const all = await listMigrations();
  for (const m of all) {
    const appliedRow = applied.get(m.order);
    if (appliedRow) {
      const file = await fs.readFile(m.file, 'utf8');
      const checksum = fileChecksum(file);
      if (!appliedRow.checksum) {
        console.log(`X ${m.order} ${m.name} (NO CHECKSUM – run: migrate backfill)`);
      } else if (appliedRow.checksum !== checksum) {
        console.log(`X ${m.order} ${m.name} (DRIFT!)`);
      } else {
        console.log(`X ${m.order} ${m.name}`);
      }
    } else {
      console.log(`  ${m.order} ${m.name}`);
    }
  }
}

async function backfillChecksums(opts: { quiet?: boolean } = {}) {
  await ensureTable();
  const pool = getPool();
  const { rows } = await pool.query('SELECT version, name, checksum FROM schema_migrations WHERE checksum IS NULL ORDER BY version');
  if (rows.length === 0) {
    if (!opts.quiet) console.log('No checksum backfill needed.');
    return;
  }
  if (!opts.quiet) console.log(`Backfilling checksums for ${rows.length} legacy migration(s)...`);
  for (const r of rows) {
    const version = Number(r.version);
    const files = await listMigrations();
    const mf = files.find(f => f.order === version);
    if (!mf) {
      console.error(`! Could not find migration file for version ${version} (${r.name}); skipping.`);
      continue;
    }
    const content = await fs.readFile(mf.file, 'utf8');
    const checksum = fileChecksum(content);
    await pool.query('UPDATE schema_migrations SET checksum=$1 WHERE version=$2', [checksum, version]);
    if (!opts.quiet) console.log(`✓ ${version} ${r.name}`);
  }
  if (!opts.quiet) console.log('Checksum backfill complete. NOTE: Drift prior to this baseline cannot be detected.');
}

async function rebaseline() {
  guardUnsafe('rebaseline');
  await ensureTable();
  const pool = getPool();
  const applied = await appliedMap();
  const all = await listMigrations();
  let changed = 0;
  for (const m of all) {
    const row = applied.get(m.order);
    if (!row) continue;
    if (row.checksum) {
      const content = await fs.readFile(m.file, 'utf8');
      const current = fileChecksum(content);
      if (row.checksum !== current) {
        await pool.query('UPDATE schema_migrations SET checksum=$1 WHERE version=$2', [current, m.order]);
        console.log(`✔ Rebaselined ${m.order} ${m.name}`);
        changed++;
      }
    } else {
      // treat as backfill scenario
      const content = await fs.readFile(m.file, 'utf8');
      const current = fileChecksum(content);
      await pool.query('UPDATE schema_migrations SET checksum=$1 WHERE version=$2', [current, m.order]);
      console.log(`✔ Backfilled (during rebaseline) ${m.order} ${m.name}`);
      changed++;
    }
  }
  if (changed === 0) {
    console.log('No drifted migrations to rebaseline.');
  } else {
    console.log(`Rebaseline complete (${changed} updated).`);
  }
  console.log('NOTE: Rebaseline accepts current files as truth; prior versions cannot be validated after this.');
}

async function createNewMigration(nameArg?: string) {
  const nameParts = process.argv.slice(3);
  const rawName = nameArg || (nameParts.length ? nameParts.join('_') : undefined);
  if (!rawName) {
    console.log('Usage: migrate new <name>');
    process.exit(1);
  }
  const safe = rawName.trim().toLowerCase().replace(/[^a-z0-9_]+/g,'_').replace(/_{2,}/g,'_').replace(/^_|_$/g,'');
  const existing = await listMigrations();
  const nextNumber = (existing.length ? existing[existing.length-1].order + 1 : 1);
  const padded = String(nextNumber).padStart(4,'0');
  const fileName = `${padded}_${safe}.sql`;
  const fullPath = path.join(migrationsDir, fileName);
  const template = `-- ${padded}_${safe}\n-- Write your SQL statements below. Generated at ${new Date().toISOString()}\n\n-- your statements here\n`;
  await fs.writeFile(fullPath, template, { flag: 'wx' });
  // Auto-generate paired down file template
  const downFileName = `${padded}_${safe}.down.sql`;
  const downFullPath = path.join(migrationsDir, downFileName);
  const downTemplate = `-- Down migration for ${padded}_${safe}\n-- Provide statements to undo the changes in ${fileName}.\n-- NOTE: Keep this in sync before applying the up migration.\n\n-- down statements here (reverse of up)\n`;
  await fs.writeFile(downFullPath, downTemplate, { flag: 'wx' });
  console.log(`Created migration ${fileName}\n  ↳ and down template ${downFileName}`);
  console.log(fullPath);
}

async function migrateDown() {
  guardUnsafe('down');
  await ensureTable();
  if (!(await acquireLock())) {
    console.error('Could not acquire advisory lock. Another migration process may be running.');
    process.exit(2);
  }
  try {
    const pool = getPool();
    const args = process.argv.slice(3);
    const countArg = args.find(a => /^\d+$/.test(a));
    const count = countArg ? parseInt(countArg, 10) : 1;
    if (count < 1) {
      console.error('Rollback count must be >= 1');
      process.exit(1);
    }
    const { rows } = await pool.query('SELECT version, name FROM schema_migrations ORDER BY version DESC');
    if (rows.length === 0) {
      console.log('No applied migrations to roll back.');
      return;
    }
    const toRollback = rows.slice(0, count);
    for (const r of toRollback) {
      const version: number = Number(r.version);
      const name: string = r.name;
      const padded = String(version).padStart(4,'0');
      const downFile = path.join(migrationsDir, `${padded}_${name}.down.sql`);
      try {
        await fs.access(downFile);
      } catch {
        console.error(`✗ Missing down file: ${padded}_${name}.down.sql`);
        console.error('Abort rollback. (Create the down file or specify a different migration).');
        process.exit(1);
      }
      const sql = await fs.readFile(downFile, 'utf8');
      console.log(`→ Rolling back ${version} - ${name}`);
      await pool.query('BEGIN');
      try {
        await pool.query(sql);
        await pool.query('DELETE FROM schema_migrations WHERE version=$1', [version]);
        await pool.query('COMMIT');
        console.log(`✓ Rolled back ${version}`);
      } catch (e) {
        await pool.query('ROLLBACK');
        console.error(`✗ Failed to roll back ${version}`);
        console.error(e);
        process.exit(1);
      }
    }
  } finally {
    await releaseLock().catch(()=>{});
  }
}

function guardUnsafe(action: string) {
  const env = process.env.MIGRATION_ENV || process.env.NODE_ENV;
  if (env === 'production') {
    if (process.env.MIGRATION_FORCE === '1') return;
    console.error(`Refusing to run '${action}' in production without MIGRATION_FORCE=1`);
    process.exit(3);
  }
}

async function check() {
  await ensureTable();
  const applied = await appliedMap();
  const all = await listMigrations();
  let drift = 0; let pending = 0; let missingChecksums = 0;
  for (const m of all) {
    const row = applied.get(m.order);
    if (!row) { pending++; continue; }
    const file = await fs.readFile(m.file, 'utf8');
    const checksum = fileChecksum(file);
    if (!row.checksum) missingChecksums++;
    else if (row.checksum !== checksum) drift++;
  }
  if (pending === 0 && drift === 0 && missingChecksums === 0) {
    console.log('MIGRATION CHECK: OK');
    return;
  }
  if (pending) console.error(`Pending migrations: ${pending}`);
  if (drift) console.error(`Drifted migrations: ${drift}`);
  if (missingChecksums) console.error(`Migrations missing checksum: ${missingChecksums}`);
  process.exit(10);
}

async function main() {
  const cmd = process.argv[2] || 'up';
  switch (cmd) {
    case 'up':
      await migrateUp();
      break;
    case 'status':
      await status();
      break;
    case 'backfill':
      await backfillChecksums();
      break;
    case 'rebaseline':
      await rebaseline();
      break;
    case 'new':
      await createNewMigration();
      break;
    case 'down':
      await migrateDown();
      break;
    case 'check':
      await check();
      break;
    default:
      console.log('Unknown command. Usage: migrate [up|status|backfill|rebaseline|new|down|check]');
  }
  process.exit(0);
}

main();
