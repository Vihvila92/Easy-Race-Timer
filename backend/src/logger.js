const pino = require('pino');
const { loadConfig } = require('./config');

let cachedLogger;
function getLogger() {
  if (!cachedLogger) {
    let level = process.env.LOG_LEVEL || 'info';
    try {
      const cfg = loadConfig();
      if (cfg.LOG_LEVEL) level = cfg.LOG_LEVEL;
    } catch (e) {
      // In unit mode without DATABASE_URL config may fail; keep default level
    }
    cachedLogger = pino({
      level,
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime
    });
  }
  return cachedLogger;
}

module.exports = { logger: getLogger(), getLogger };
