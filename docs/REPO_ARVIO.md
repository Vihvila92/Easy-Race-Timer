# Easy-Race-Timer – repoarvio (14.10.2026)

Tämä teksti kuvaa puuta tagissa `legacy-2025`. Se ei ole nykyisen version arkkitehtuuri. Nykyinen ohjelma on [MAARITTELY.md](MAARITTELY.md) ja [adr/](adr/).

Repo: github.com/Vihvila92/Easy-Race-Timer · 28 committia · viimeisin oma muutos 9.8.2025, sen jälkeen vain Dependabot.

## Tekninen pino
- Backend: Node 20, Express 4, zod, pino, pg (PostgreSQL + Row-Level Security, multi-tenant "organisaatiot"). Sekoitus JS/TS:ää.
- Frontend: **ei koodia lainkaan** – `frontend/` sisältää vain README-placeholderin (React+TS+Tailwind suunniteltu).
- Infra: docker-compose (Postgres), 10 SQL-migraatiota, CI (GitHub Actions + Postgres-palvelu), CodeQL, Dependabot, CODEOWNERS, PR-pohja.

## Mitä on toteutettu (~750 riviä)
- `/health`, kilpailujen listaus/luonti, osallistujien (entries) listaus/luonti – kaikki org-kontekstin (RLS) kautta.
- Taulut: organizations, competitors, competitions, competition_categories, competition_entries, timing_events.
- **Ei** lähtöä, maaliintulojen kirjausta, numerolapun yhdistämistä, tuloslaskentaa, tulostusta/CSV:tä eikä käyttöliittymää. Eli varsinaista ajanottoa ei ole.

## Koodin laatu
- Yksittäiset reitit siistejä (zod-validointi, virhekoodit, sivutus).
- Ylisuunniteltu: RLS, multi-tenancy, 3 käyttöönottomallia (standalone/VPS/Kubernetes), 736-rivinen arkkitehtuuridokumentti ennen yhtäkään toimivaa näkymää.
- Sotkua: `db.js`, `db.ts` ja `db.cjs` rinnakkain; `npm run dev` viittaa tiedostoon `src/index.ts`, jota ei ole (oikea on `index.js`).

## Testit / CI
- 6 Jest-testitiedostoa (health, config, competitions, entries, orgContext, smoke), supertest. CI ajaa migraatiot + testit Postgresia vasten. Toimiva pohja, mutta testaa vain CRUDia.

## Avoimet "issuet" (7 kpl)
Kaikki 7 ovat Dependabotin riippuvuus-PR:iä, ei ominaisuuspyyntöjä: #38 minimatch, #37 qs+express, #36 dotenv/pg, #33 @types/node 25, #32 zod 4, #30 pino 10, #28 Express 5. Voi sulkea, jos aloitetaan alusta.

## Ominaisuusideat dokumenteista (tiekarttaa varten)
- Lajit: juoksu/maraton/cross, pyöräily (maantie, CX, MTB), triathlon, hiihto.
- Kilpailutyypit: yhteislähtö, yksilölähdöt (time trial), monipäiväiset, viestit, sarjakisat/cup-pisteet.
- Sarjat iän/sukupuolen/tason mukaan; seuran kilpailijarekisteri; ilmoittautuminen.
- Usean laitteen ajanotto + NTP-tyyppinen aikasynkronointi; useamman sekuntikellon varmistus; manuaalisen ajanoton eheys (audit-loki).
- Reaaliaikaiset tulokset (WebSocket); kaksikielisyys fi/en; toimivuus vanhoilla laitteilla ja hitaalla netillä; GDPR, varmuuskopiot; roolipohjaiset näkymät.

## Uudelleenkäytettävää
- Tietomallin käsitteet (kilpailu, sarja, kilpailija, osallistuminen+numerolappu, ajanottotapahtuma) – siirrettävissä SQLiteen.
- zod-validointi- ja virhekoodimalli, `docs/api/ERROR_CODES.md`.
- CI-, CodeQL-, Dependabot- ja PR-pohjakonfiguraatiot (muokattuna).
- Ideat/dokumentaatio tiekartaksi.

## Rakennettava uudelleen
- Postgres+RLS+multi-tenancy → SQLite, yksi paikallinen kone, ei organisaatioita MVP:ssä.
- Koko frontend (ei ole olemassa) – HIG-tyylinen, offline-kykyinen PWA.
- Kaikki ajanottologiikka (lähtö, maalikirjaus, lappuyhdistys, tulokset, CSV/tulostus).

## Suositus
**Aloita puhtaalta pöydältä** (uusi haara tai uusi repo), ja poimi vanhasta vain tietomallin käsitteet, validointimalli, CI-konfiguraatiot ja ideat. Nykyinen koodi on vain CRUD-runko monimutkaiselle multi-tenant-arkkitehtuurille, eikä siinä ole yhtään käyttöliittymää tai ajanottotoimintoa, joten jatkaminen tarkoittaisi lähinnä purkamista.
