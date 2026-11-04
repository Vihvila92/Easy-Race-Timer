# Dokumentaatio

Nykyinen ohjelma on Easy Race Timer v0.1: yksi kannettava, SQLite, React-PWA.

| Tiedosto | Sisältö |
|---|---|
| [MAARITTELY.md](MAARITTELY.md) | Määrittely. Tämä on tuotteen lähde. |
| [roadmap.md](roadmap.md) | Tiekartta. Julkaisuputki rakentaa allekirjoittamattomat asentimet. |
| [release.md](release.md) | Julkaisun tarkistus englanniksi: tarkistussummat, attestaatiot, Gatekeeper, SmartScreen. |
| [release.fi.md](release.fi.md) | Sama suomeksi. |
| [adr/](adr/) | Päätökset 0001–0014. 0001–0007: SQLite, append-only-ajanotto, moduulirajat, offline, lisenssi, henkilö ja suostumus, seurat. 0008–0014: anonymisointi, API, työpöytäsovellus, käyttöliittymän pohja, SPDX-otsikot ja lähdekoodilinkki, [0013 key-management](adr/0013-key-management.md), [0014 encrypted-race-file](adr/0014-encrypted-race-file.md). |
| [spec/key-management.md](spec/key-management.md) | Avainten määrittely (englanti, [#131](https://github.com/Vihvila92/Easy-Race-Timer/issues/131)): kaksi ylläpitäjää, palautusavain, erillinen avaintiedosto. Päätös [adr/0013-key-management.md](adr/0013-key-management.md). |
| [api/ERROR_CODES.md](api/ERROR_CODES.md) | Virhekoodit ja HTTP-statukset. |
| [api/openapi.yaml](api/openapi.yaml) | REST-sopimus v0.1. |
| [protocol/sync-v1.md](protocol/sync-v1.md) | WebSocket `proto=1` ja `.ertx`. |
| [REPO_ARVIO.md](REPO_ARVIO.md) | Arvio puusta, joka on tagissa `legacy-2025`. Ei kuvaa tätä versiota. |

Käynnistys ja testit: [README.md](../README.md) (englanti) ja [README.fi.md](../README.fi.md) (suomi).
