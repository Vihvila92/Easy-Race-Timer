const { Pool } = require('pg');

/**
 * Set the current organization context in the DB session (GUC app.current_org_id)
 * @param {import('pg').PoolClient} client
 * @param {string} orgId UUID of organization
 */
async function setOrgContext(client, orgId) {
  await client.query('SELECT set_config($1, $2, false)', ['app.current_org_id', orgId]);
}

/** Clear organization context */
async function clearOrgContext(client) {
  await client.query("SELECT set_config('app.current_org_id', null, false)");
}

/**
 * Run a function with an org context applied using a pool.
 * @template T
 * @param {import('pg').Pool} pool
 * @param {string} orgId
 * @param {(client: import('pg').PoolClient)=>Promise<T>} fn
 * @returns {Promise<T>}
 */
async function runWithOrg(pool, orgId, fn) {
  const client = await pool.connect();
  try {
    await setOrgContext(client, orgId);
    return await fn(client);
  } finally {
    try { await clearOrgContext(client); } catch { /* ignore */ }
    client.release();
  }
}

module.exports = { setOrgContext, clearOrgContext, runWithOrg };
