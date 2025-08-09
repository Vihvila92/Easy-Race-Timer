const express = require('express');
const { z } = require('zod');
const { getPool } = require('../lib/db');
const { runWithOrg } = require('../lib/orgContext');

// Validation schemas
const createCompetitionSchema = z.object({
  name: z.string().min(1).max(200),
  start_time: z.string().datetime().optional(), // ISO datetime string
});

const router = express.Router();

// List competitions (scoped by RLS org context header)
router.get('/', async (req, res, next) => {
  const orgId = req.orgId;
  if (!orgId) return res.status(400).json({ error: { code: 'ORG_HEADER_REQUIRED', message: 'x-org-id header required' } });
  try {
    const pool = getPool();
    const rows = await runWithOrg(pool, orgId, async (client) => {
  const { rows } = await client.query('SELECT id, name, start_time, created_at FROM competitions ORDER BY created_at DESC LIMIT 100');
      return rows;
    });
    res.json({ data: rows });
  } catch (e) { next(e); }
});

// Create competition
router.post('/', async (req, res, next) => {
  const orgId = req.orgId;
  if (!orgId) return res.status(400).json({ error: { code: 'ORG_HEADER_REQUIRED', message: 'x-org-id header required' } });
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
