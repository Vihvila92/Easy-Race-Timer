// Plain JS version of getPool for Jest without TS transform
const { Pool } = require('pg');
require('dotenv').config();

let pool;
function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set');
    const stmtTimeoutMs = parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '5000', 10);
    const appName = process.env.DB_APPLICATION_NAME || 'easy-race-timer';
    const idleTxnTimeoutMs = parseInt(process.env.DB_IDLE_TXN_TIMEOUT_MS || '10000', 10);
    const lockTimeoutMs = parseInt(process.env.DB_LOCK_TIMEOUT_MS || '5000', 10);
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      statement_timeout: stmtTimeoutMs,
      application_name: appName,
      options: `-c search_path=public -c idle_in_transaction_session_timeout=${idleTxnTimeoutMs} -c lock_timeout=${lockTimeoutMs}`
    });
  }
  return pool;
}

module.exports = { getPool };
