const pino = require('pino');
const { loadConfig } = require('./config');

const config = loadConfig();

const logger = pino({
  level: process.env.LOG_LEVEL || config.LOG_LEVEL || 'info',
  base: undefined, // omit pid, hostname
  timestamp: pino.stdTimeFunctions.isoTime
});

module.exports = { logger };
