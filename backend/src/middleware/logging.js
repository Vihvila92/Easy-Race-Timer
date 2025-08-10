const { getLogger } = require('../logger');

function loggingMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  const child = getLogger().child({ reqId: req.id, orgId: req.orgId });
  req.log = child;
  res.on('finish', () => {
    const durMs = Number(process.hrtime.bigint() - start) / 1e6;
    child.info({ method: req.method, path: req.originalUrl, status: res.statusCode, duration_ms: durMs.toFixed(1) }, 'request');
  });
  next();
}

module.exports = { loggingMiddleware };
