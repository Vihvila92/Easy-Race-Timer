// Plain JS version of getPool for Jest without TS transform
const { Pool } = require('pg');
require('dotenv').config();
const { logger } = require('../logger');

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
    // Wrap query for timing
    const origQuery = pool.query.bind(pool);
    pool.query = async function (...args) {
      const start = process.hrtime.bigint();
      try {
        const result = await origQuery(...args);
        const durMs = Number(process.hrtime.bigint() - start) / 1e6;
        if (durMs > (parseInt(process.env.DB_SLOW_QUERY_MS || '200', 10))) {
          logger.warn({ sql: args[0], duration_ms: durMs.toFixed(1) }, 'slow query');
        }
        return result;
      } catch (e) {
        const durMs = Number(process.hrtime.bigint() - start) / 1e6;
        logger.error({ sql: args[0], duration_ms: durMs.toFixed(1), err: e.message }, 'query error');
        throw e;
      }
    };
  }
  return pool;
}

module.exports = { getPool };
