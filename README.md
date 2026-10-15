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

## Pikakäynnistys kehittäjälle

Tarvitaan Node.js 22 ja pnpm 10.33. Nämä komennot ovat kehittäjälle. Seuralaisen polku on myöhempi asennuspaketti, ei komentorivi. Katso [docs/roadmap.md](docs/roadmap.md).

```bash
pnpm install
pnpm rebuild better-sqlite3 esbuild
pnpm build
pnpm dev:server
```

Avaa osoite, jonka prosessi tulostaa rivillä `ERT_READY`. Kehittäjän palvelin käyttää porttia 8080 ja kansiota `./data`. Käyttöliittymä on suomeksi ja englanniksi, vaaleana ja tummana. Ilman kisaa ensimmäinen näkymä on ohjattu luonti.

`pnpm dev` käynnistää Vite-käyttöliittymän välityspalvelimella. Se on vain kehitysapu, eikä osoite ole mukana rakennetussa käyttöliittymässä.

`pnpm start` ilman muuttujia käyttäytyy kuin tuleva työpöytäkuori: vapaa paikallinen portti ja käyttöjärjestelmän käyttäjähakemisto.

## Testit

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm e2e
```

`pnpm e2e` rakentaa käyttöliittymän ja ajaa Playwrightin. Hyväksymisskenaario on Kuulan hölkkä, [`testdata/kuulan-holkka/`](testdata/kuulan-holkka/).

## Tiekartta

v0.1 on tässä repossa. Seuraava seuralaiselle näkyvä julkaisu on allekirjoitettu yhden napsautuksen asennin. Sitä ei ole vielä tehty. [docs/roadmap.md](docs/roadmap.md). Päätökset: [`docs/adr/`](docs/adr/).

## Lisenssi ja SaaS

Lisenssi on juuritiedosto `LICENSE` (vuoden 2025 urheilulisenssi). Määrittelyn AGPL-3.0-only-suositus odottaa tekijänoikeuden haltijan päätöstä, eikä sitä ole otettu käyttöön. Paikallisessa versiossa ei ole lisenssiavaimia eikä ominaisuusrajoituksia. Laskutus, pilvivälitys ja juoksijaportaali eivät kuulu tähän repoon.

Lähdekoodi: <https://github.com/Vihvila92/Easy-Race-Timer>
