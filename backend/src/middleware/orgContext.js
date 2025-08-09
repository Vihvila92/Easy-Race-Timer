function orgContextMiddleware(req, _res, next) {
  const raw = req.get && req.get('x-org-id');
  if (raw && typeof raw === 'string') {
    req.orgId = raw;
  }
  next();
}

module.exports = { orgContextMiddleware };
