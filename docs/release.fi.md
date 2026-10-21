# Julkaisun asentimet

Suomenkieliset ohjeet latauksen tarkistamiseen. English: [release.md](release.md).

Release-työnkulku (`.github/workflows/release.yml`) rakentaa työpöytäohjelman kolmelle käyttöjärjestelmälle.

| Käynnistys | Tulos |
|---|---|
| Actions → Release → Run workflow | Kuivaharjoitus. Asentimet ovat työnkulun artefakteja. GitHub-julkaisua ei tehdä. |
| Työnnetty `v*`-tagi, esimerkiksi `v0.1.0` | GitHub-julkaisu, jossa ovat asentimet, päivitystiedostot, tarkistussummat ja SBOM:t. |

Kuivaharjoituksen tiedostot ovat ajon sivulla artefakteissa `installers-linux`, `installers-macos`, `installers-windows` ja yhdistetyssä `release-assets`-artefaktissa. `release-assets` sisältää myös `checksums.txt`-tiedoston ja molemmat SBOM:t.

## Paketit

| Järjestelmä | Tiedostot |
|---|---|
| Windows | `.msi` ja NSIS-`.exe` |
| macOS | universal-`.dmg`, ad-hoc-allekirjoitus (`signingIdentity` on `-`). Ei notarisointia. |
| Linux | `.AppImage` ja `.deb` |

Maksullista Applen notarisointia tai Windowsin varmennetta ei käytetä. Tässä mielessä asentimet ovat allekirjoittamattomia.

### macOS Gatekeeper

Jos macOS ilmoittaa, ettei ohjelmaa voi avata koska kehittäjää ei voida varmistaa, napsauta ohjelmaa oikealla painikkeella ja valitse **Open** (suomeksi **Avaa**), sitten uudelleen **Open** / **Avaa**.

### Windows SmartScreen

Jos Windows SmartScreen ilmoittaa tuntemattomasta ohjelmasta, valitse **More info** (suomeksi **Lisätietoja**) ja sitten **Run anyway** (suomeksi **Suorita silti**).

## Tarkista tagattu julkaisu

Attestaation tarkistus tarvitsee [GitHub CLI:n](https://cli.github.com/). `sha256sum` on Linuxissa. macOS:lla sama tarkistus on `shasum -a 256 -c checksums.txt`, jos `sha256sum` puuttuu.

```sh
gh release download vX.Y.Z --repo Vihvila92/Easy-Race-Timer
sha256sum -c checksums.txt
gh attestation verify FILE \
  --repo Vihvila92/Easy-Race-Timer \
  --signer-workflow Vihvila92/Easy-Race-Timer/.github/workflows/release.yml \
  --source-ref refs/tags/vX.Y.Z
```

Vaihda `vX.Y.Z` tagiin ja `FILE` kuhunkin asentimeen (`.msi`, `.exe`, `.dmg`, `.AppImage`, `.deb`), kuhunkin päivitysarkistoon (`.tar.gz`, `.nsis.zip`, `.msi.zip`), kuhunkin `.sig`-tiedostoon ja tiedostoon `latest.json`. Tarkistussummakomento tarkistaa jokaisen `checksums.txt`-tiedostossa luetellun tiedoston. Attestaatiokomento epäonnistuu, jos tiedostoa ei ole rakentanut tämän tietovaraston Release-työnkulku kyseiselle tagille.

Kuivaharjoitus lataa vain työnkulun artefakteja. Ne eivät ole GitHub-julkaisu, eikä niillä ole attestaatioita. Tarkista ne komennolla `sha256sum -c checksums.txt` artefaktista `release-assets`.

## Materiaaliluettelot ja päivitystiedostot

Tagattu julkaisu sisältää lisäksi:

- `sbom-npm.cdx.json` — CycloneDX-SBOM pnpm-lukkotiedostosta
- `sbom-cargo.cdx.json` — CycloneDX-SBOM komennolla `cargo cyclonedx` hakemistosta `src-tauri/`
- `checksums.txt` — jokaisen muun tiedoston SHA-256
- `latest.json` ja `.sig`-tiedostot — Taurin päivityksen metadata tagatussa julkaisussa
- kuivaharjoituksessa allekirjoittamattomat päivitysarkistot: `.app.tar.gz`, `.AppImage.tar.gz`, `.nsis.zip` ja `.msi.zip`

## Päivityksen allekirjoitus

Julkinen avain on `plugins.updater.pubkey` tiedostossa `src-tauri/tauri.conf.json`. Commitoitu arvo on paikkamerkki `TODO_REPLACE_WITH_UPDATER_PUBKEY`, kunnes tietovaraston ylläpitäjä luo avainparin. CI ei lue julkista avainta salaisuudesta eikä ympäristömuuttujasta, eikä se vaihda avainta käännöksen aikana.

Yksityinen avain ei ole tietovaraston salaisuus. Asennintyöt eivät saa sitä. Ne pakkaavat päivitysarkistot ilman allekirjoituksia. Vain `sign`-työ lukee yksityisen avaimen. Työ käynnistyy vain, kun `v*`-tagi työnnetään, ja vain GitHub-ympäristöstä nimeltä `release`. Kuivaharjoitus (`workflow_dispatch`, myös tagista käynnistetty) ei käytä tuota ympäristöä eikä allekirjoita.

`sign`-työ ei asenna tämän tietovaraston riippuvuuksia. Se tarkistaa, että tagin commit sisältyy haaraan `main` (`git merge-base --is-ancestor "$GITHUB_SHA" origin/main`), hylkää paikkamerkin, allekirjoittaa nonce-tiedoston ja vertaa sen commitoidun julkisen avaimen kanssa, ja ajaa sitten `tauri signer sign` päivitysarkistoille. Jos tagille on jo GitHub-julkaisu, julkaisu pysähtyy eikä korvaa tiedostoja.

### Asetukset, jotka ylläpitäjän on luotava ennen ensimmäistä tagia

Nämä ovat tietovaraston asetuksia. Työnkulku ei luo niitä.

GitHub → Settings → Environments → New environment. Nimeksi täsmälleen `release`.

- Required reviewers: Valtteri (`Vihvila92`). Julkaisu odottaa, kunnes hän hyväksyy sen.
- Deployment branches and tags: Selected tags. Salli vain tagin nimikuvio `v*`. Älä salli haaroja.
- Ympäristön `release` salaisuudet (eivät tietovaraston salaisuuksia):
  - `TAURI_SIGNING_PRIVATE_KEY` — komennon `pnpm tauri signer generate` tulostama yksityinen avain
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — avaimen salasana, tai tyhjä arvo, jos avaimella ei ole salasanaa
- Älä luo salaisuutta nimeltä `TAURI_SIGNING_PUBLIC_KEY`.

GitHub → Settings → Rules → New ruleset, kohteena tagit:

- Nimi: `release-tags`
- Kohde: tagit, jotka vastaavat kuviota `v*`
- Rajoita luonti tietovaraston ylläpitäjille
- Estä näiden tagien force-push
- Estä näiden tagien poisto

Tagi, jonka commit ei ole haarassa `main`, epäonnistuu silti `sign`-työssä. Sitä sääntöjoukko ei yksin tarkista.

Luo avainpari luotetulla koneella, ei CI:ssä:

```sh
pnpm tauri signer generate -w "$HOME/.tauri/easy-race-timer.key"
```

Korvaa `src-tauri/tauri.conf.json`-tiedoston `TODO_REPLACE_WITH_UPDATER_PUBKEY` komennon tulostamalla julkisella avaimella. Tallenna yksityinen avain vain `release`-ympäristöön. Älä commitoi yksityistä avainta. Ensimmäinen `v*`-tagi epäonnistuu `sign`-työssä, kunnes paikkamerkki on vaihdettu ja yllä oleva ympäristö on olemassa.

Työpöytäikkuna on yhä käyttöliittymä ilman seuran palvelinta. Palvelin sidecarina tulee myöhemmin. Päivityslisäosa tulee myöhemmin; avain commitoidaan nyt, jotta julkaisun allekirjoitus on kiinnitetty gitiin.
