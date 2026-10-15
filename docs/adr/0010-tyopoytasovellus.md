# ADR 0010: Työpöytäsovellus ilman erillistä palvelinta

- Tila: hyväksytty rajauksena. Asennuspakettia ei tehdä vielä.
- Päivä: 2026-10-14

## Tausta

Seuralainen osaa selata ja käyttää sähköpostia. Komentorivi, Docker ja erillinen palvelimen asennus eivät ole hänelle mahdollisia vaiheita. Myöhemmin ohjelma jaetaan allekirjoitettuna yhden napsautuksen asennuksena Windowsille ja macOS:lle. Todennäköinen kuori on Tauri, ja tämä Node-palvelin kulkee sidecarina.

## Päätös

Kuori ei saa joutua tuntemaan kisan sääntöjä. Siksi nämä ovat jo tässä repossa:

- Käyttöliittymä on sama origin kuin API. Kutsut ovat suhteellisia. Rakennettuun käyttöliittymään ei kirjoiteta osoitetta eikä porttia. Kehittäjän Vite-proxy on vain paikallinen kehitysapu.
- `PORT` tyhjänä tai `0`: käyttöjärjestelmä antaa vapaan portin. Prosessi tulostaa stdoutiin yhden rivin `ERT_READY` ja JSON-rungon (`url`, `dataDir`, `dbPath`). Kuori avaa ikkunan siihen.
- Oletushakemisto on käyttöjärjestelmän käyttäjäkohtainen datahakemisto. `ERT_DATA_DIR` vaihtaa hakemiston, `ERT_DB` vaihtaa tiedoston. Kanta on SQLite. Varmuuskopio viiden minuutin välein samaan hakemistoon.
- Ilman tapahtumaa ohjelma näyttää ohjatun kisan luonnin, ei tyhjää toimistonäkymää.
- Palvelin kuuntelee edelleen vain paikallista osoitetta.

Asenninta, allekirjoitusta ja Tauri-projektia ei lisätä tässä versiossa.

## Seuraukset

- `pnpm start` ilman ympäristömuuttujia käyttäytyy kuin tuleva sidecar.
- Kehittäjä, joka haluaa kiinteän portin 8080 ja kansion `./data`, käyttää `pnpm dev:server`.
- Testit antavat yhä `PORT`- ja `ERT_DB`-arvot, joten ne eivät kirjoita kehittäjän käyttäjähakemistoon.
