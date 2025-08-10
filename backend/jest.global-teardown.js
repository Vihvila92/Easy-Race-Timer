module.exports = async () => {
  try {
    const { getPool } = require('./src/lib/db');
    const pool = getPool();
    await pool.end();
  } catch (e) {
    // ignore
  }
};
