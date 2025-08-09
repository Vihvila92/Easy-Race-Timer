const express = require('express');
const { z } = require('zod');
const { getPool } = require('../lib/db');
const { runWithOrg } = require('../lib/orgContext');

const router = express.Router();

// Validation for creating an entry
const createEntrySchema = z.object({
  competition_id: z.string().uuid(),
  competitor_id: z.string().uuid(),
  bib_number: z.number().int().positive().max(99999).optional()
});

// List entries for a competition
router.get('/competitions/:id/entries', async (req, res, next) => {
  const orgId = req.orgId;
  if (!orgId) return res.status(400).json({ error: { code: 'ORG_HEADER_REQUIRED', message: 'x-org-id header required' } });
  const competitionId = req.params.id;
  try {
    const pool = getPool();
    const rows = await runWithOrg(pool, orgId, async (client) => {
      const { rows } = await client.query(
        `SELECT ce.id, ce.bib_number, ce.created_at, ce.competition_id, ce.competitor_id,
                comp.first_name, comp.last_name
           FROM competition_entries ce
           JOIN competitors comp ON comp.id = ce.competitor_id
          WHERE ce.competition_id = $1
          ORDER BY ce.created_at ASC
          LIMIT 500`, [competitionId]
      );
      return rows;
    });
    res.json({ data: rows });
  } catch (e) { next(e); }
});

// Create entry
router.post('/entries', async (req, res, next) => {
  const orgId = req.orgId;
  if (!orgId) return res.status(400).json({ error: { code: 'ORG_HEADER_REQUIRED', message: 'x-org-id header required' } });
  const parsed = createEntrySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid body', details: parsed.error.issues } });
  }
  const { competition_id, competitor_id, bib_number } = parsed.data;
  try {
    const pool = getPool();
    const row = await runWithOrg(pool, orgId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO competition_entries(competition_id, competitor_id, bib_number)
         VALUES ($1,$2,$3)
         RETURNING id, competition_id, competitor_id, bib_number, created_at`,
        [competition_id, competitor_id, bib_number || null]
      );
      return rows[0];
    });
    res.status(201).json({ data: row });
  } catch (e) {
    if (e.code === '23505') { // unique violation
      return res.status(409).json({ error: { code: 'ENTRY_EXISTS', message: 'Competitor already entered in competition' } });
    }
    next(e);
  }
});

module.exports = { entriesRouter: router };
