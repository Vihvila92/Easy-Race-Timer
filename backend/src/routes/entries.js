const express = require('express');
const { z } = require('zod');
const { getPool } = require('../lib/db');
const { runWithOrg } = require('../lib/orgContext');
const { requireOrgMiddleware } = require('../middleware/requireOrg');

const router = express.Router();

// Validation for creating an entry
const createEntrySchema = z.object({
  competition_id: z.string().uuid(),
  competitor_id: z.string().uuid(),
  bib_number: z.number().int().positive().max(99999).optional()
});

const listEntriesQuerySchema = z.object({
  limit: z.string().optional(),
  offset: z.string().optional()
});

// List entries for a competition
router.get('/competitions/:id/entries', requireOrgMiddleware, async (req, res, next) => {
  const orgId = req.orgId;
  const competitionId = req.params.id;
  const parsed = listEntriesQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid query params', details: parsed.error.issues } });
  const limit = Math.min(parseInt(parsed.data.limit || '500', 10), 1000);
  const offset = Math.max(parseInt(parsed.data.offset || '0', 10), 0);
  try {
    const pool = getPool();
    const result = await runWithOrg(pool, orgId, async (client) => {
      // First ensure competition visible (RLS will filter; zero rows => 404)
      const compCheck = await client.query('SELECT id FROM competitions WHERE id=$1', [competitionId]);
      if (compCheck.rowCount === 0) return { notFound: true };
      const { rows } = await client.query(
        `SELECT ce.id, ce.bib_number, ce.created_at, ce.competition_id, ce.competitor_id,
                comp.first_name, comp.last_name
           FROM competition_entries ce
           JOIN competitors comp ON comp.id = ce.competitor_id
          WHERE ce.competition_id = $1
          ORDER BY ce.created_at ASC
          LIMIT $2 OFFSET $3`, [competitionId, limit, offset]
      );
      return { rows };
    });
    if (result.notFound) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Competition not found' } });
    res.json({ data: result.rows, pagination: { limit, offset, count: result.rows.length } });
  } catch (e) { next(e); }
});

// Create entry
router.post('/entries', requireOrgMiddleware, async (req, res, next) => {
  const orgId = req.orgId;
  const parsed = createEntrySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid body', details: parsed.error.issues } });
  }
  const { competition_id, competitor_id, bib_number } = parsed.data;
  try {
    const pool = getPool();
    const row = await runWithOrg(pool, orgId, async (client) => {
      // Ensure both competition and competitor visible (RLS scope); fail with 404 if either hidden
      const compCheck = await client.query('SELECT id FROM competitions WHERE id=$1', [competition_id]);
      if (compCheck.rowCount === 0) return { notFound: 'competition' };
      const competitorCheck = await client.query('SELECT id FROM competitors WHERE id=$1', [competitor_id]);
      if (competitorCheck.rowCount === 0) return { notFound: 'competitor' };
      const { rows } = await client.query(
        `INSERT INTO competition_entries(competition_id, competitor_id, bib_number)
         VALUES ($1,$2,$3)
         RETURNING id, competition_id, competitor_id, bib_number, created_at`,
        [competition_id, competitor_id, bib_number || null]
      );
      return { row: rows[0] };
    });
    if (row?.notFound) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: `${row.notFound} not found` } });
    }
    res.status(201).json({ data: row.row });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: { code: 'ENTRY_EXISTS', message: 'Competitor already entered in competition' } });
    }
    next(e);
  }
});

module.exports = { entriesRouter: router };
