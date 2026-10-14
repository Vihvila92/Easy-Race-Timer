# Easy Race Timer

Yhden kannettavan ajanotto juoksukilpailuun. v0.1 kattaa valmistelun, yhteislähdön, maalikirjauksen, tulokset ja säilytysajan anonymisoinnin. Verkkoa ei tarvita.

Määrittely on [`docs/MAARITTELY.md`](docs/MAARITTELY.md). English: [`README_EN.md`](README_EN.md). Dokumentaation kartta: [`docs/README.md`](docs/README.md).

## Repo

```
packages/core            tuloslaskenta, sarjat, virheet
packages/people          seurat, suostumus, anonymisointi
packages/i18n            suomi ja englanti
packages/sports          juoksuprofiili
packages/timing-sources  kosketusmaali
packages/race-formats    yhteislähtö
packages/exporters       CSV ja A4-tuloste
packages/storage         SQLite
packages/sync            .ertx
packages/server          Fastify, composition root
packages/web             React-PWA
e2e/                     Playwright, Kuulan hölkkä
testdata/kuulan-holkka/  oraakkeli
```

Vuoden 2025 Postgres-luonnos on vain tagissa `legacy-2025`.

## Pikakäynnistys

Tarvitaan Node.js 22 ja pnpm 10.33.

```bash
pnpm install
pnpm rebuild better-sqlite3 esbuild
pnpm dev
```

Toinen pääte:

```bash
pnpm start
```

Avaa `http://127.0.0.1:8080`. Käyttöliittymä on suomeksi ja englanniksi, vaaleana ja tummana. Maalinäyttö pysyy hereillä (wake lock) ja nappi täyttää vähintään kolmanneksen näytöstä.

Tuotanto yhdellä prosessilla:

```bash
pnpm build
ERT_DB=./data/ert.sqlite pnpm start
```

Palvelin kuuntelee oletuksena vain localhostia (`HOST`, `PORT`). Tietokanta on SQLite, WAL ja `synchronous=FULL`. Varmuuskopio viiden minuutin välein.

## Testit

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm e2e
```

`pnpm e2e` rakentaa käyttöliittymän ja ajaa Playwrightin. Hyväksymisskenaario on Kuulan hölkkä, [`testdata/kuulan-holkka/`](testdata/kuulan-holkka/).

## Tiekartta

| Milestone | Sisältö |
|---|---|
| M0–M2 | Monorepo, valmistelu, ajanotto, tulokset, anonymisointi |
| M3 | Kuormitustesti on mukana. Kenraaliharjoitus ja kenttäkäyttö tehdään kisapaikalla. |
| v0.2 | Usea laite, väliajat, LAN-synkronointi |
| v0.4 | SaaS-beta erillisessä repossa |
| v1.x | Natiivisovellukset ja juoksijaportaali |

Päätökset: [`docs/adr/`](docs/adr/).

## Lisenssi ja SaaS

Lisenssi on juuritiedosto `LICENSE` (vuoden 2025 urheilulisenssi). Määrittelyn AGPL-3.0-only-suositus odottaa tekijänoikeuden haltijan päätöstä, eikä sitä ole otettu käyttöön. Paikallisessa versiossa ei ole lisenssiavaimia eikä ominaisuusrajoituksia. Laskutus, pilvivälitys ja juoksijaportaali eivät kuulu tähän repoon.

Lähdekoodi: <https://github.com/Vihvila92/Easy-Race-Timer>
