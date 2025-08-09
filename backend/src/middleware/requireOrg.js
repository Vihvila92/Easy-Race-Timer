function requireOrgMiddleware(req, res, next) {
  if (!req.orgId) {
    return res.status(400).json({ error: { code: 'ORG_HEADER_REQUIRED', message: 'x-org-id header required' } });
  }
  next();
}

module.exports = { requireOrgMiddleware };
