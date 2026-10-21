// SPDX-License-Identifier: AGPL-3.0-only
// Luonnos: Playwright-E2E Kuulan hölkälle. Tiedosto siirretään polkuun e2e/kuulan-holkka.spec.ts, kun web-sovellus on olemassa.
// Valitsimet (data-testid) sovitaan toteutuksessa; tämä kuvaa testin rakenteen ja tarkistukset.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseCsv, runAction, exportResultsCsv, setTestClock, restartServer } from './helpers';

const dir = 'testdata/kuulan-holkka';
const raceDay = JSON.parse(readFileSync(`${dir}/race-day.json`, 'utf8'));

test('Kuulan hölkkä: valmistelusta lukittuihin tuloksiin ilman verkkoa', async ({ page, context, request }) => {
  await context.setOffline(true); // asiakas ilman verkkoa; palvelin localhostissa

  await test.step('tuo tapahtuma ja ilmoittautumiset', async () => {
    await request.post('/api/v1/events/import', { data: JSON.parse(readFileSync(`${dir}/event.json`, 'utf8')) });
    await page.goto('/admin/entries/import');
    await page.setInputFiles('[data-testid=csv-file]', `${dir}/entries.csv`);
    await expect(page.getByTestId('import-summary')).toContainText('67');
    // vertaa sarjaehdotukset tiedostoon expected-categories.csv (molemmat ikäperusteet)
  });

  await test.step('kisapäivä', async () => {
    for (const [i, a] of raceDay.actions.entries()) {
      await setTestClock(request, a.at);
      await runAction(page, a); // käyttää oikeaa UI:ta: lähtö-, maali-, korjaus- ja toimistonäkymät
      if (a.type === 'finish_tap' && a.tap_id === 'F030') await restartServer({ hard: true });
      // confirm_tie_order: runAction käyttää tasatulosnäkymää. 22:13 raahaamalla, 21:32 näppäimistöllä, 41:07 "Tasan".
    }
  });

  await test.step('tasatulosnäkymä: raahaus ja näppäimistö', async () => {
    // Erillinen pienempi testi: raahaa rivi ja peru (Kumoa), siirrä näppäimistöllä, vahvista;
    // tarkista, että audit-lokissa on peruste ja että sija päivittyy sekä sarjassa että yleisissä tuloksissa.
  });

  await test.step('tulokset vastaavat oraakkelia', async () => {
    const actual = parseCsv(await exportResultsCsv(request, raceDay.event_id));
    const expected = parseCsv(readFileSync(`${dir}/expected-results.csv`, 'utf8'));
    const key = (r: any) => [r.race, r.scope, r.rank, r.bib, r.time, r.status].join(';');
    expect(actual.map(key)).toEqual(expected.map(key));
  });
});
