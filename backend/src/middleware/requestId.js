const { randomUUID } = require('crypto');

function requestIdMiddleware(req, _res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming || randomUUID();
  next();
}

module.exports = { requestIdMiddleware };
