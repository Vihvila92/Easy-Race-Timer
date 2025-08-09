import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL not set');
    }
    const stmtTimeoutMs = parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '5000', 10);
    const appName = process.env.DB_APPLICATION_NAME || 'easy-race-timer';
    const idleTxnTimeoutMs = parseInt(process.env.DB_IDLE_TXN_TIMEOUT_MS || '10000', 10);
    const lockTimeoutMs = parseInt(process.env.DB_LOCK_TIMEOUT_MS || '5000', 10);
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      statement_timeout: stmtTimeoutMs,
      application_name: appName,
      // Never rely on search_path; use explicit schema (public). Lock it down.
      options: `-c search_path=public -c idle_in_transaction_session_timeout=${idleTxnTimeoutMs} -c lock_timeout=${lockTimeoutMs}`
    });
  }
  return pool;
}

export async function dbConnect() {
  const p = getPool();
  await p.query('SELECT 1');
  // Enforce runtime GUCs per session defensively (in case pool reused across differing envs)
  await p.query('SET search_path=public');
  if (process.env.DB_STATEMENT_TIMEOUT_MS) await p.query('SET statement_timeout = $1', [process.env.DB_STATEMENT_TIMEOUT_MS]);
  if (process.env.DB_IDLE_TXN_TIMEOUT_MS) await p.query('SET idle_in_transaction_session_timeout = $1', [process.env.DB_IDLE_TXN_TIMEOUT_MS]);
  if (process.env.DB_LOCK_TIMEOUT_MS) await p.query('SET lock_timeout = $1', [process.env.DB_LOCK_TIMEOUT_MS]);
  return p;
}

// CommonJS bridge for JS requires (tests) without ts-node
// @ts-ignore
if (typeof module !== 'undefined') {
  // @ts-ignore
  module.exports = { getPool, dbConnect };
}
