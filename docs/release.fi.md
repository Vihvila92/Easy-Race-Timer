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
gh attestation verify FILE --repo Vihvila92/Easy-Race-Timer
```

Vaihda `vX.Y.Z` tagiin ja `FILE` kuhunkin asentimeen (`.msi`, `.exe`, `.dmg`, `.AppImage`, `.deb`). Tarkistussummakomento tarkistaa jokaisen `checksums.txt`-tiedostossa luetellun tiedoston. Attestaatiokomento epäonnistuu, jos tiedostoa ei ole rakennettu tämän tietovaraston GitHub Actionsissa.

Kuivaharjoitus lataa vain työnkulun artefakteja. Ne eivät ole GitHub-julkaisu, eikä niillä ole attestaatioita. Tarkista ne komennolla `sha256sum -c checksums.txt` artefaktista `release-assets`.

## Materiaaliluettelot ja päivitystiedostot

Tagattu julkaisu sisältää lisäksi:

- `sbom-npm.cdx.json` — CycloneDX-SBOM pnpm-lukkotiedostosta
- `sbom-cargo.cdx.json` — CycloneDX-SBOM komennolla `cargo cyclonedx` hakemistosta `src-tauri/`
- `checksums.txt` — jokaisen muun tiedoston SHA-256
- `latest.json` ja `.sig`-tiedostot — Taurin päivityksen metadata, kun allekirjoitussalaisuudet on asetettu

Päivityksen allekirjoitus tarvitsee salaisuudet `TAURI_SIGNING_PRIVATE_KEY` ja `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` sekä vastaavan julkisen avaimen tiedostossa `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`) tai salaisuudessa `TAURI_SIGNING_PUBLIC_KEY`. Pari luodaan komennolla `pnpm tauri signer generate`. Vain yksityinen avain tallennetaan salaisuudeksi. Kuivaharjoitus rakentaa asentimet ilman näitä salaisuuksia.

Työpöytäikkuna on yhä käyttöliittymä ilman seuran palvelinta. Palvelin sidecarina tulee myöhemmin.
