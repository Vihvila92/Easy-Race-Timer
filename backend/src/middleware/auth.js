const { verifyToken } = require('../lib/auth');

function authMiddleware(req, _res, next) {
  const header = req.get('authorization');
  if (header && header.startsWith('Bearer ')) {
    const token = header.slice(7);
    try {
      const decoded = verifyToken(token);
      req.user = { id: decoded.sub, email: decoded.email };
      if (decoded.orgId) req.orgId = decoded.orgId; // prefer token org claim
    } catch (e) {
      // invalid token ignored; protected routes will enforce
    }
  }
  next();
}

module.exports = { authMiddleware };
