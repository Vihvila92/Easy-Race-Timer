# Easy Race Timer

Yhden kannettavan ajanotto juoksukilpailuun. v0.1 kattaa valmistelun, yhteislähdön, maalikirjauksen, tulokset ja säilytysajan anonymisoinnin. Verkkoa ei tarvita.

Määrittely on [`docs/MAARITTELY.md`](docs/MAARITTELY.md). English: [`README.md`](README.md). Dokumentaation kartta: [`docs/README.md`](docs/README.md).

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

Tarvitaan Node.js 22 ja pnpm 10.33. Nämä komennot ovat kehittäjälle. Seuran vapaaehtoisen polku on myöhempi asennuspaketti, ei komentorivi. Katso [docs/roadmap.md](docs/roadmap.md).

```bash
pnpm install
pnpm rebuild better-sqlite3 esbuild
pnpm build
pnpm dev:server
```

Avaa osoite, jonka prosessi tulostaa rivillä `ERT_READY`. Kehittäjän palvelin käyttää porttia 8080 ja kansiota `./data`. Käyttöliittymä on suomeksi ja englanniksi, vaaleana ja tummana. Ilman kisaa ensimmäinen näkymä on ohjattu luonti.

`pnpm dev` käynnistää Vite-käyttöliittymän välityspalvelimella. Se on vain kehitysapu, eikä osoite ole mukana rakennetussa käyttöliittymässä.

`pnpm start` ilman muuttujia käyttäytyy kuin tuleva työpöytäkuori: vapaa paikallinen portti ja käyttöjärjestelmän käyttäjähakemisto.

## Työpöytäsovellus (Tauri, kehittäjäversio)

`src-tauri/` on pienin mahdollinen Tauri 2 -kuori rakennetun käyttöliittymän (`packages/web/dist`) ympärillä. Siinä ei ole omia komentoja, ja sillä on vain `core:default`-oikeus. Node-palvelin sidecarina (ADR 0010) ja päivittäjä (#136) tulevat myöhemmin, joten ikkuna näyttää toistaiseksi käyttöliittymän ilman taustapalvelua.

Vaatimukset: Rust (stable) ja Linuxilla `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `librsvg2-dev` ja `libayatana-appindicator3-dev`. Windowsin ja macOS:n vaatimukset löytyvät Taurin ohjeesta.

```sh
pnpm install
pnpm tauri dev                            # ikkuna, jossa Viten pikapäivitys
pnpm tauri build --bundles appimage,deb   # Linux: AppImage + .deb
```

Pakettimuodot: Windows `msi` ja `nsis`, macOS universal `dmg` (ad-hoc-allekirjoitus, ei notarisointia), Linux `appimage` ja `deb`. Asentimet ovat allekirjoittamattomia. Julkaisuversiot tekee julkaisuputki (#153), ei `check`-ajo.

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

## Osallistuminen

Katso [`CONTRIBUTING.md`](CONTRIBUTING.md) ja [toimintaperiaatteet](CODE_OF_CONDUCT.md). Ilmoita tietoturvaongelmat yksityisesti ohjeen [`SECURITY.md`](SECURITY.md) mukaan.

## Lisenssi ja SaaS

Ohjelmisto on lisensoitu GNU Affero General Public License v3.0 -lisenssillä (SPDX `AGPL-3.0-only`, ks. `LICENSE`). Ulkopuolisilta kontribuuttoreilta pyydetään CLA (ks. [CLA.md](CLA.md)). Kaupalliset lisenssit: valtteri@vehvilainen.cc. Paikallisessa versiossa ei ole lisenssiavaimia eikä ominaisuusrajoituksia. Laskutus, pilvivälitys ja juoksijaportaali eivät kuulu tähän repoon.

Lähdekoodi: <https://github.com/Vihvila92/Easy-Race-Timer>
