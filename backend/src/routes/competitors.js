const express = require('express');
const { z } = require('zod');
const { getPool } = require('../lib/db');
const { runWithOrg } = require('../lib/orgContext');
const { requireOrgMiddleware } = require('../middleware/requireOrg');

const router = express.Router();

const listQuerySchema = z.object({
  limit: z.string().optional(),
  offset: z.string().optional()
});

const createCompetitorSchema = z.object({
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  birth_year: z.number().int().min(1900).max(2100).optional()
});

const updateCompetitorSchema = z.object({
  first_name: z.string().min(1).max(100).optional(),
  last_name: z.string().min(1).max(100).optional(),
  birth_year: z.number().int().min(1900).max(2100).optional()
});
const updateCompetitorSchema = z.object({
  first_name: z.string().min(1).max(100).optional(),
  last_name: z.string().min(1).max(100).optional(),
  birth_year: z.number().int().min(1900).max(2100).nullable().optional()
}).refine(d => Object.keys(d).length > 0, { message: 'At least one field required' });

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

// List competitors
router.get('/', requireOrgMiddleware, async (req, res, next) => {
  const orgId = req.orgId;
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid query params', details: parsed.error.issues } });
  const limit = Math.min(parseInt(parsed.data.limit || String(DEFAULT_LIMIT), 10), MAX_LIMIT);
  const offset = Math.max(parseInt(parsed.data.offset || '0', 10), 0);
  try {
    const pool = getPool();
    const rows = await runWithOrg(pool, orgId, async (client) => {
      const { rows } = await client.query('SELECT id, first_name, last_name, birth_year, created_at FROM competitors ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
      return rows;
    });
    res.json({ data: rows, pagination: { limit, offset, count: rows.length } });
  } catch (e) { next(e); }
});

// Competitor detail
router.get('/:id', requireOrgMiddleware, async (req, res, next) => {
  const orgId = req.orgId; const id = req.params.id;
  try {
    const pool = getPool();
    const row = await runWithOrg(pool, orgId, async (client) => {
      const { rows } = await client.query('SELECT id, first_name, last_name, birth_year, created_at FROM competitors WHERE id=$1', [id]);
      return rows[0];
    });
    if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Competitor not found' } });
    res.json({ data: row });
  } catch (e) { next(e); }
});

// Create competitor
router.post('/', requireOrgMiddleware, async (req, res, next) => {
  const orgId = req.orgId;
  const parse = createCompetitorSchema.safeParse(req.body);
  if (!parse.success) return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid body', details: parse.error.issues } });
  const { first_name, last_name, birth_year } = parse.data;
  try {
    const pool = getPool();
    const row = await runWithOrg(pool, orgId, async (client) => {
      const { rows } = await client.query('INSERT INTO competitors(organization_id, first_name, last_name, birth_year) VALUES ($1,$2,$3,$4) RETURNING id, first_name, last_name, birth_year, created_at', [orgId, first_name, last_name, birth_year || null]);
      return rows[0];
    });
    res.status(201).json({ data: row });
  } catch (e) { next(e); }
});

// Patch competitor
router.patch('/:id', requireOrgMiddleware, async (req, res, next) => {
  const orgId = req.orgId; const id = req.params.id;
  const parsed = updateCompetitorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid body', details: parsed.error.issues } });
  const fields = parsed.data;
  const sets = []; const values = []; let idx = 1;
  const allowedColumns = ['first_name', 'last_name', 'birth_year'];
  const sets = []; const values = []; let idx = 1;
  for (const [k, v] of Object.entries(fields)) {
    if (allowedColumns.includes(k)) {
      sets.push(`${k} = $${idx++}`);
      values.push(v === undefined ? null : v);
    }
  }
  if (sets.length === 0) {
    return res.status(400).json({ error: { code: 'NO_VALID_FIELDS', message: 'No valid fields to update' } });
  }
  values.push(id); const idPosition = idx;
  try {
    const pool = getPool();
    const row = await runWithOrg(pool, orgId, async (client) => {
      const { rows } = await client.query(`UPDATE competitors SET ${sets.join(', ')} WHERE id = $${idPosition} RETURNING id, first_name, last_name, birth_year, created_at`, values);
      return rows[0];
    });
    if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Competitor not found' } });
    res.json({ data: row });
  } catch (e) { next(e); }
});

// Delete competitor
router.delete('/:id', requireOrgMiddleware, async (req, res, next) => {
  const orgId = req.orgId; const id = req.params.id;
  try {
    const pool = getPool();
    const deleted = await runWithOrg(pool, orgId, async (client) => {
      const { rowCount } = await client.query('DELETE FROM competitors WHERE id=$1', [id]);
      return rowCount;
    });
    if (deleted === 0) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Competitor not found' } });
    res.status(204).send();
  } catch (e) { next(e); }
});

module.exports = { competitorsRouter: router };
