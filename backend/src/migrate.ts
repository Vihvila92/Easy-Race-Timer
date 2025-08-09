#!/usr/bin/env ts-node
/* Simple migration runner */
import { promises as fs } from 'fs';
import path from 'path';
import { getPool } from './lib/db';

interface MigrationFile { order: number; name: string; file: string; }

const migrationsDir = path.join(process.cwd(), 'database', 'schema', 'migrations');

async function ensureTable() {
  const pool = getPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (id BIGSERIAL PRIMARY KEY, version BIGINT UNIQUE NOT NULL, name TEXT NOT NULL, run_at TIMESTAMPTZ DEFAULT now());`);
}

async function listMigrations(): Promise<MigrationFile[]> {
  const files = await fs.readdir(migrationsDir);
  return (files as string[])
    .filter((f: string) => /^(\d+)_.*\.sql$/.test(f))
    .map((f: string) => {
      const match = f.match(/^(\d+)_([^.]*)\.sql$/)!;
      return { order: parseInt(match[1], 10), name: match[2], file: path.join(migrationsDir, f) };
    })
    .sort((a: MigrationFile, b: MigrationFile) => a.order - b.order);
}

async function appliedVersions(): Promise<Set<number>> {
  const pool = getPool();
  const { rows } = await pool.query('SELECT version FROM schema_migrations');
  return new Set(rows.map((r: any) => Number(r.version)));
}

async function migrateUp() {
  await ensureTable();
  const all = await listMigrations();
  const applied = await appliedVersions();
  const pool = getPool();
  for (const m of all) {
    if (!applied.has(m.order)) {
      const sql = await fs.readFile(m.file, 'utf8');
      console.log(`Applying migration ${m.order} - ${m.name}`);
      await pool.query('BEGIN');
      try {
        await pool.query(sql);
        await pool.query('INSERT INTO schema_migrations(version, name) VALUES ($1,$2)', [m.order, m.name]);
        await pool.query('COMMIT');
      } catch (e) {
        await pool.query('ROLLBACK');
        console.error('Migration failed', e);
        process.exit(1);
      }
    }
  }
}

async function status() {
  await ensureTable();
  const applied = await appliedVersions();
  const all = await listMigrations();
  for (const m of all) {
    console.log(`${applied.has(m.order) ? 'X' : ' '} ${m.order} ${m.name}`);
  }
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
    default:
      console.log('Unknown command');
  }
  process.exit(0);
}

main();
