# Easy Race Timer

Yhden kannettavan ajanotto juoksukilpailuun. v0.1 kattaa valmistelun, yhteislähdön, maalikirjauksen, tulokset ja säilytysajan anonymisoinnin. Verkkoa ei tarvita.

Määrittely on [`docs/MAARITTELY.md`](docs/MAARITTELY.md). English: [`README.md`](README.md). Dokumentaation kartta: [`docs/README.md`](docs/README.md).

## Repo

```
packages/core            tuloslaskenta, sarjat, virheet
packages/people          seurat, suostumus, anonymisointi
packages/i18n            suomi ja englanti (`locales/fi.json`, `locales/en.json`)
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

Avaa osoite, jonka prosessi tulostaa rivillä `ERT_READY`. Kehittäjän palvelin käyttää porttia 8080 ja kansiota `./data`. Käyttöliittymä on suomeksi ja englanniksi, vaaleana ja tummana. Ilman kisaa ensimmäinen näkymä on ohjattu luonti. Jos ajanotto-ohjelmaan ei saada yhteyttä, näkymä kertoo sen valitulla kielellä ja tarjoaa painikkeen Yritä uudelleen. Kehitysversiossa yhteiset komponentit katsotaan osoitteessa `#/preview`. Tuotantoversio ei rekisteröi sitä reittiä.

`pnpm dev` käynnistää Vite-käyttöliittymän välityspalvelimella. Se on vain kehitysapu, eikä osoite ole mukana rakennetussa käyttöliittymässä.

`pnpm start` ilman muuttujia käyttäytyy kuin työpöytäkuori: vapaa paikallinen portti ja käyttöjärjestelmän käyttäjähakemisto.

## Työpöytäsovellus (Tauri)

`src-tauri/` on Tauri 2 -kuori. Käynnistyksessä se tyhjentää ympäristön ja asettaa `HOST=127.0.0.1`, `PORT=0`, `ERT_DATA_DIR` (käyttöjärjestelmän sovellusdatahakemisto) ja `NODE_ENV=production`. Unixilla se asettaa myös `LANG`. Windowsilla se säilyttää kuoren `SystemRoot`- ja `WINDIR`-muuttujat ja jättää muut muuttujat asettamatta. Se kirjoittaa käynnistyskohtaisen tunnisteen sidecarin vakiosyötteeseen. Se odottaa enintään 20 sekuntia yhtä stdout-riviä: `ERT_READY` ja JSON. Sitten se avaa osoitteen `http://127.0.0.1:<port>/auth?code=…`. Koodi on kertakäyttöinen. `/auth` vastaa `Cache-Control: no-store` ja asettaa HttpOnly-istuntoevästeen (`ert_launch`, ei `Max-Age`- eikä `Expires`-arvoa). API ja websocket vaativat evästeen tai bearer-tunnisteen. Tunnistamaton `/ws` saa HTTP 401:n ennen protokollan vaihtoa. Ikkunalla ei ole shell- tai prosessirajapintaa. Ikkunan sulkeminen sulkee sidecarin vakiosyötteen, ja sidecar päättyy myös, jos kuoriprosessi katoaa.

Paketin käyttöliittymätiedostot ja tietokantamoduuli tallennetaan sovellusdatahakemistoon ja tarkistetaan sidecariin upotetuilla SHA-256-tiivisteillä. Windowsilla käyttäjäkohtainen `%APPDATA%` on raja: sidecar ei tarkista siellä hakemiston omistajaa eikä oikeuksia. Jokainen käynnistys tarkistaa silti jokaisen puretun tiedoston SHA-256-tiivisteen upotettuja tiivisteitä vasten ja korvaa tiedoston, joka ei täsmää. Toinen instanssi nostaa esiin jo avatun ikkunan. Sidecar pitää myös yksinoikeudella lukkoa datahakemistossa, kun käynnistystunniste on asetettu.

Jos sidecar epäonnistuu tai valmisriviä ei tule, ikkuna näyttää staattisen suomen- ja englanninkielisen virhesivun tyhjän näkymän sijaan. Kuoren sivun CSP on `default-src 'none'; style-src 'self'`.

Jokainen palvelimen vastaus, myös HTML-tulokset, lähettää otsakkeet `Content-Security-Policy` (mukana `default-src 'self'`, `connect-src 'self'` ja `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff` ja `Referrer-Policy: no-referrer`.

`pnpm build:sidecar` rakentaa käyttöliittymän ja pakkaa `packages/server`-palvelimen Node 22.23.3 -yhdeksi suoritettavaksi. Se kääntää `better-sqlite3`:n sillä Nodella. macOS:n universal-käännös kääntää moduulin uudelleen arm64- ja x64-arkkitehtuureille, ja kummankin viipaleen SEA-blobin tuottaa sen arkkitehtuurin Node-binääri (x64-viipale käyttää x64-Nodea Rosettan kautta, ei arm64-Nodea). `lipo` yhdistää viipaleet tiedostoksi `src-tauri/binaries/ert-server-universal-apple-darwin` ja tulos ad-hoc-allekirjoitetaan. Tauri paketoi ohuet tiedostot `ert-server-aarch64-apple-darwin` ja `ert-server-x86_64-apple-darwin`. Muut kohteet kirjoittavat `src-tauri/binaries/ert-server-<target-triple>` (Windowsissa `.exe`). Sitä ei commitoida. `pnpm tauri build` ajaa skriptin ensin. `check`-ajo ei rakenna sitä. Release-työnkulku ajaa saman käännöksen ja tulostaa universal-binäärille `file`- ja `lipo -info` -tarkistukset ennen asenninten rakentamista.

Vaatimukset: Node.js 22.23.3 ja Rust 1.90 tai uudempi (`rust-toolchain.toml`; CI asentaa 1.90.0). Linuxilla tarvitaan myös `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `librsvg2-dev`, `patchelf` ja `libayatana-appindicator3-dev`. Windowsin ja macOS:n muut vaatimukset löytyvät Taurin ohjeesta.

```sh
pnpm install
pnpm rebuild better-sqlite3 esbuild
pnpm build:sidecar
pnpm tauri dev
pnpm tauri build --bundles appimage,deb   # Linux: AppImage + .deb
```

Pakettimuodot: Windows `msi` ja `nsis`, macOS universal `dmg` (ad-hoc-allekirjoitus, ei notarisointia), Linux `appimage` ja `deb`. Maksullista Applen tai Windowsin varmennetta ei ole. Release-työnkulku rakentaa asentimet ja `v*`-tagista GitHub-julkaisun. Pakollinen `check`-ajo ei rakenna sidecar-tiedostoa eikä asenninta. Tarkistus, Gatekeeper ja SmartScreen: [docs/release.fi.md](docs/release.fi.md). Päivittäjä (#136) ei kuulu tähän kuoreen.

## Testit

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm e2e
```

`pnpm e2e` rakentaa käyttöliittymän ja ajaa Playwrightin. Hyväksymisskenaario on Kuulan hölkkä, [`testdata/kuulan-holkka/`](testdata/kuulan-holkka/).

## Tiekartta

v0.1 on tässä repossa. Tagattu julkaisu julkaisee allekirjoittamattomat asentimet Windowsille, macOS:lle ja Linuxille ([docs/release.fi.md](docs/release.fi.md)). Maksullinen allekirjoitus ei ole käytössä. Node-palvelin kulkee työpöytäsovelluksen sidecarina. [docs/roadmap.md](docs/roadmap.md). Päätökset: [`docs/adr/`](docs/adr/).

## Osallistuminen

Katso [`CONTRIBUTING.md`](CONTRIBUTING.md) ja [toimintaperiaatteet](CODE_OF_CONDUCT.md). Ilmoita tietoturvaongelmat yksityisesti ohjeen [`SECURITY.md`](SECURITY.md) mukaan.

## Lisenssi ja SaaS

Ohjelmisto on lisensoitu GNU Affero General Public License v3.0 -lisenssillä (SPDX `AGPL-3.0-only`, ks. `LICENSE`). Ulkopuolisilta kontribuuttoreilta pyydetään CLA (ks. [CLA.md](CLA.md)). Kaupalliset lisenssit: valtteri@vehvilainen.cc. Paikallisessa versiossa ei ole lisenssiavaimia eikä ominaisuusrajoituksia. Laskutus, pilvivälitys ja juoksijaportaali eivät kuulu tähän repoon.

Lähdekoodi: <https://github.com/Vihvila92/Easy-Race-Timer>
