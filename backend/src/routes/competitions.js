const express = require('express');
const { z } = require('zod');
const { getPool } = require('../lib/db');
const { runWithOrg } = require('../lib/orgContext');
const { requireOrgMiddleware } = require('../middleware/requireOrg');

// Pagination constants
const DEFAULT_COMPETITION_LIST_LIMIT = 100;
const MAX_COMPETITION_LIST_LIMIT = 200;

// Validation schemas
const createCompetitionSchema = z.object({
  name: z.string().min(1).max(200),
  start_time: z.string().datetime().optional(), // ISO datetime string
});

const listQuerySchema = z.object({
  limit: z.string().optional(),
  offset: z.string().optional()
});

const router = express.Router();

// List competitions
router.get('/', requireOrgMiddleware, async (req, res, next) => {
  const orgId = req.orgId;
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid query params', details: parsed.error.issues } });
  const limit = Math.min(
    parseInt(parsed.data.limit || String(DEFAULT_COMPETITION_LIST_LIMIT), 10),
    MAX_COMPETITION_LIST_LIMIT
  );
  const offset = Math.max(parseInt(parsed.data.offset || '0', 10), 0);
  try {
    const pool = getPool();
    const rows = await runWithOrg(pool, orgId, async (client) => {
      const { rows } = await client.query('SELECT id, name, start_time, created_at FROM competitions ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
      return rows;
    });
    res.json({ data: rows, pagination: { limit, offset, count: rows.length } });
  } catch (e) { next(e); }
});

// Create competition
router.post('/', requireOrgMiddleware, async (req, res, next) => {
  const orgId = req.orgId;
  const parse = createCompetitionSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid body', details: parse.error.issues } });
  }
  const { name, start_time } = parse.data;
  try {
    const pool = getPool();
    const row = await runWithOrg(pool, orgId, async (client) => {
      const { rows } = await client.query(
        'INSERT INTO competitions(organization_id, name, start_time) VALUES ($1,$2,$3) RETURNING id, name, start_time, created_at',
        [orgId, name, start_time || null]
      );
      return rows[0];
    });
    res.status(201).json({ data: row });
  } catch (e) { next(e); }
});

module.exports = { competitionsRouter: router };
