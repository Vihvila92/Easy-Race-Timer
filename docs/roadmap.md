# Tiekartta

English summary is at the bottom.

## Nyt (v0.1)

Yksi kannettava ajaa kisan. Kehittäjä käynnistää sen tästä reposta. Seuralainen saa asennuspaketin GitHub-julkaisusta, kun `v*`-tagi on työnnetty. Paketti on toistaiseksi allekirjoittamaton.

## Työpöytäsovellus

Avoin versio on seuratoimitsijoille, jotka osaavat selata verkkoa ja käyttää sähköpostia. Heille ei tule komentoriviä, Dockeria eikä erillistä palvelimen asennusta.

Release-työnkulku rakentaa allekirjoittamattomat asentimet Windowsille (msi ja nsis), macOS:lle (universal dmg, ad-hoc) ja Linuxille (AppImage ja deb). Maksullinen allekirjoitus ja notarisointi eivät ole käytössä. Node-palvelin kulkee mukana sidecarina. Tarkistusohje: [release.fi.md](release.fi.md).

Kuori voi jäädä ohueksi, koska nämä ovat jo voimassa:

- Selainikkuna ja API ovat sama origin. Käyttöliittymä kutsuu vain suhteellisia polkuja `/api` ja `/ws`. Siihen ei ole kirjoitettu konetta eikä porttia.
- Jos `PORT` puuttuu, prosessi varaa vapaan paikallisen portin ja tulostaa yhden rivin: `ERT_READY {"url","dataDir","dbPath"}`. Kuori lukee rivin ja avaa ikkunan siihen osoitteeseen.
- Tiedot ovat käyttöjärjestelmän käyttäjähakemistossa (`ERT_DATA_DIR` tai `ERT_DB` voi ohittaa sen). SQLite-tiedosto on `ert.sqlite`. Varmuuskopio kirjoitetaan `backups/`-kansioon viiden minuutin välein.
- Ensimmäinen näkymä on kolmen vaiheen ohjattu kisan luonti: nimi ja päivä, matkat, vahvistus. Sen jälkeen ohjelma ohjaa ilmoittautumisten tuontiin.
- Kehittäjän `pnpm`-komennot jäävät tähän repoon. Ne eivät ole seuralaisen polku.

Päätös: [adr/0010-tyopoytasovellus.md](adr/0010-tyopoytasovellus.md).

## Myöhemmin

| Versio | Sisältö |
|---|---|
| v0.2 | Usea laite, väliajat, lähiverkon synkronointi |
| v0.4 | SaaS-beta erillisessä repossa |
| v1.x | Natiivisovellukset ja juoksijaportaali |

## Desktop app

The open-source app is for club volunteers. The release workflow builds unsigned installers for Windows, macOS and Linux, and the Node server ships as a sidecar. Paid signing and notarization are not in use. Verification: [release.md](release.md).

The shell can stay thin. The UI uses same-origin relative URLs only. With `PORT` unset, the process binds a free local port and prints `ERT_READY` plus the URL and data directory. Data is an SQLite file in the OS user-data directory, with backups every five minutes. The first screen is a three-step wizard that creates the race. Volunteers do not use a terminal, Docker, or a separate server install.
