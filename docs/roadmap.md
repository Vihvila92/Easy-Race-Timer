# Tiekartta

English summary is at the bottom.

## Nyt (v0.1)

Yksi kannettava ajaa kisan. Kehittäjä käynnistää sen tästä reposta. Seuralainen ei vielä saa asennuspakettia.

## Työpöytäsovellus (seuraava julkaisu, ei tässä muutoksessa)

Avoin versio on seuratoimitsijoille, jotka osaavat selata verkkoa ja käyttää sähköpostia. Heille ei tule komentoriviä, Dockeria eikä erillistä palvelimen asennusta.

Myöhempi julkaisu on allekirjoitettu yhden napsautuksen asennin Windowsille ja macOS:lle. Todennäköinen kuori on Tauri. Palvelin kulkee mukana sidecar-prosessina. Tätä asenninta, Tauri-projektia ja allekirjoitusta ei tehdä vielä.

Kuori voi jäädä ohueksi, koska nämä ovat jo voimassa:

- Selainikkuna ja API ovat sama origin. Käyttöliittymä kutsuu vain suhteellisia polkuja `/api` ja `/ws`. Siihen ei ole kirjoitettu konetta eikä porttia.
- Jos `PORT` puuttuu, prosessi varaa vapaan paikallisen portin ja tulostaa yhden rivin: `ERT_READY {"url","dataDir","dbPath"}`. Kuori lukee rivin ja avaa ikkunan siihen osoitteeseen.
- Tiedot ovat käyttöjärjestelmän käyttäjähakemistossa (`ERT_DATA_DIR` tai `ERT_DB` voi ohittaa sen). Kisatiedosto `ert.sqlite` on salattu SQLCipher-tiedosto. Varmuuskopio on sama salattu tiedosto ja se kirjoitetaan `backups/`-kansioon viiden minuutin välein.
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

The open-source app is for club volunteers. A later release is a signed one-click installer for Windows and macOS, most likely Tauri, with the server as a sidecar. This repository does not add that installer.

The shell can stay thin. The UI uses same-origin relative URLs only. With `PORT` unset, the process binds a free local port and prints `ERT_READY` plus the URL and data directory. Data is an encrypted SQLCipher file in the OS user-data directory, with encrypted backups every five minutes. The first screen is a three-step wizard that creates the race. Volunteers do not use a terminal, Docker, or a separate server install.
