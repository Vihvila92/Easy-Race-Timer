import { getPool } from '../lib/db';
import { runWithOrg } from '../lib/orgContext';
import type { PoolClient } from 'pg';
import crypto from 'crypto';

interface SeedOptions { orgs?: number; competitorsPerOrg?: number; competitionsPerOrg?: number; entriesPerCompetition?: number; }

const randName = () => {
  const first = ['Alice','Bob','Charlie','Diana','Eve','Frank','Grace','Heidi','Ivan','Judy'];
  const last = ['Runner','Racer','Sprinter','Dash','Stride','Pace','Trail','Track'];
  return {
    first: first[Math.floor(Math.random()*first.length)],
    last: last[Math.floor(Math.random()*last.length)]
  };
};

async function seed(opts: SeedOptions) {
  const pool = getPool();
  const orgCt = opts.orgs ?? 2;
  const competitorsPerOrg = opts.competitorsPerOrg ?? 10;
  const competitionsPerOrg = opts.competitionsPerOrg ?? 2;
  const entriesPerCompetition = opts.entriesPerCompetition ?? 5;

  console.log(`Seeding: orgs=${orgCt} competitors/org=${competitorsPerOrg} competitions/org=${competitionsPerOrg} entries/competition=${entriesPerCompetition}`);

  // Create organizations (owner role assumed by DATABASE_URL)
  const orgIds: string[] = [];
  for (let i=0;i<orgCt;i++) {
    const { rows } = await pool.query('INSERT INTO organizations(name) VALUES ($1) RETURNING id', [`Org ${i+1}`]);
    orgIds.push(rows[0].id);
  }
  console.log(`Created ${orgIds.length} organizations`);

  for (const orgId of orgIds) {
    // Insert competitors & competitions via org context
    const competitors: string[] = [];
    for (let i=0;i<competitorsPerOrg;i++) {
  await runWithOrg(pool, orgId, async (c: PoolClient) => {
        const { first, last } = randName();
        const { rows } = await c.query('INSERT INTO competitors(organization_id, first_name, last_name, birth_year) VALUES ($1,$2,$3,$4) RETURNING id', [orgId, first, last, 1980 + (i % 30)]);
        competitors.push(rows[0].id);
      });
    }
    const competitions: string[] = [];
    for (let cIdx=0;cIdx<competitionsPerOrg;cIdx++) {
  await runWithOrg(pool, orgId, async (c: PoolClient) => {
        const { rows } = await c.query('INSERT INTO competitions(organization_id,name,start_time) VALUES ($1,$2, now() + ($3||\' hours\')::interval) RETURNING id', [orgId, `Competition ${cIdx+1}`, (cIdx*2).toString()]);
        competitions.push(rows[0].id);
      });
    }
    for (const compId of competitions) {
      // Categories
  await runWithOrg(pool, orgId, (c: PoolClient) => c.query('INSERT INTO competition_categories(competition_id,name,min_age,max_age) VALUES ($1,$2,$3,$4)', [compId, 'Open', 0, 120]));
      // Entries
      const sample = competitors.slice().sort(()=>0.5-Math.random()).slice(0, Math.min(entriesPerCompetition, competitors.length));
      let bib = 1;
      for (const competitorId of sample) {
  await runWithOrg(pool, orgId, (c: PoolClient) => c.query('INSERT INTO competition_entries(competition_id, competitor_id, bib_number) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [compId, competitorId, bib++]));
        // Timing event initial (start)
  await runWithOrg(pool, orgId, (c: PoolClient) => c.query('INSERT INTO timing_events(competition_id, competitor_id, event_time, source) VALUES ($1,$2, now(), $3)', [compId, competitorId, 'seed']));
      }
    }
    console.log(`Org ${orgId} -> competitors=${competitors.length} competitions=${competitions.length}`);
  }
  console.log('Seed complete');
}

async function main() {
  const args = process.argv.slice(2);
  const opts: SeedOptions = {};
  for (const a of args) {
    const m = a.match(/^(orgs|competitors|competitions|entries)=(\d+)$/);
    if (m) {
      const key = m[1]; const val = parseInt(m[2], 10);
      if (key === 'orgs') opts.orgs = val;
      if (key === 'competitors') opts.competitorsPerOrg = val;
      if (key === 'competitions') opts.competitionsPerOrg = val;
      if (key === 'entries') opts.entriesPerCompetition = val;
    }
  }
  await seed(opts);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
