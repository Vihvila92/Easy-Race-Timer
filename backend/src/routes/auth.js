const express = require('express');
const { z } = require('zod');
const { getPool } = require('../lib/db');
const { hashPassword, verifyPassword, signToken } = require('../lib/auth');

const router = express.Router();

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(100),
  organization_name: z.string().min(1).max(200).optional()
});

router.post('/signup', async (req, res, next) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid body', details: parsed.error.issues } });
  const { email, password, organization_name } = parsed.data;
  try {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const pwHash = await hashPassword(password);
      const userRes = await client.query('INSERT INTO users(email, password_hash) VALUES ($1,$2) RETURNING id, email, created_at', [email, pwHash]);
      const user = userRes.rows[0];
      let orgId = null;
      if (organization_name) {
        const orgRes = await client.query('INSERT INTO organizations(name) VALUES ($1) RETURNING id', [organization_name]);
        orgId = orgRes.rows[0].id;
        await client.query('INSERT INTO org_users(organization_id,user_id,role) VALUES ($1,$2,$3)', [orgId, user.id, 'owner']);
      }
      await client.query('COMMIT');
      const token = signToken({ sub: user.id, email: user.email, orgId });
      return res.status(201).json({ data: { token, user: { id: user.id, email: user.email }, orgId } });
    } catch (e) {
      await client.query('ROLLBACK');
      if (e.code === '23505') {
        return res.status(409).json({ error: { code: 'USER_EXISTS', message: 'Email already registered' } });
      }
      throw e;
    } finally {
      client.release();
    }
  } catch (e) { next(e); }
});

const loginSchema = z.object({ email: z.string().email(), password: z.string() });

router.post('/login', async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid body', details: parsed.error.issues } });
  const { email, password } = parsed.data;
  try {
    const pool = getPool();
    const userRes = await pool.query('SELECT id, email, password_hash FROM users WHERE email=$1', [email]);
    if (userRes.rowCount === 0) return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } });
    const user = userRes.rows[0];
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } });
    const membership = await pool.query('SELECT organization_id FROM org_users WHERE user_id=$1 LIMIT 1', [user.id]);
    const orgId = membership.rows[0]?.organization_id || null;
    const token = signToken({ sub: user.id, email: user.email, orgId });
    res.json({ data: { token, user: { id: user.id, email: user.email }, orgId } });
  } catch (e) { next(e); }
});

module.exports = { authRouter: router };
