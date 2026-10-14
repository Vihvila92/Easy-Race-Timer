# ADR 0005: AGPL ja SaaS-raja

- Tila: ehdotus, odottaa tekijänoikeuden haltijan päätöstä
- Päivä: 2026-10-14

## Tausta

Määrittely suosittelee AGPL-3.0-only-lisenssiä, jotta ytimestä ei voi tehdä suljettua kilpailevaa palvelua. Nykyinen lisenssi on vuoden 2025 urheilulisenssi. Lisenssin vaihto on omistajan päätös, ei tämän uudelleenkirjoituksen.

## Päätös

`LICENSE` jätetään ennalleen. SPDX-AGPL-otsikoita ei lisätä. SaaS-koodi (laskutus, provisiointi, pilvivälitys, juoksijaportaali) ei kuulu tähän repoon; se tulee myöhemmin erilliseen `easy-race-timer-cloud`-repoon ja käyttää ytimen laajennuspisteitä.

Käyttöliittymän alatunnisteessa on linkki tämän repon lähdekoodiin. CI tarkistaa riippuvuuksien lisenssit (MIT, BSD, Apache-2.0, ISC, LGPL, 0BSD, Unlicense, CC0, BlueOak-1.0.0, Python-2.0, MPL-2.0, CC-BY-4.0). MPL ja CC-BY ovat mukana, koska axe-core ja caniuse-lite eivät tarjoa sallivampaa vaihtoehtoa.

## Seuraukset

- PR ei vaihda lisenssiä eikä lisää CLA-bottia.
- Jos omistaja hyväksyy AGPL:n, vaihto on erillinen muutos: LICENSE, otsikot ja CONTRIBUTING.
