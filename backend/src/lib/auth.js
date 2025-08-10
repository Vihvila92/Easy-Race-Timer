const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET env var required');
}

const SALT_ROUNDS = 10;

async function hashPassword(pw) {
  return bcrypt.hash(pw, SALT_ROUNDS);
}

async function verifyPassword(pw, hash) {
  return bcrypt.compare(pw, hash);
}

function signToken(payload, opts = {}) {
  const secret = process.env.JWT_SECRET;
  return jwt.sign(payload, secret, { algorithm: 'HS256', expiresIn: '15m', ...opts });
}

function verifyToken(token) {
  const secret = process.env.JWT_SECRET;
  return jwt.verify(token, secret);
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken };
