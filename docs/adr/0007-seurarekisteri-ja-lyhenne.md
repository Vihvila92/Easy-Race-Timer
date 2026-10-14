# ADR 0007: Seurarekisteri ja virallinen lyhenne

- Tila: hyväksytty (v0.1)
- Päivä: 2026-10-14

## Tausta

Ilmoittautumisissa seuran nimi kirjoitetaan moneen tapaan. Tuloksissa ja tilastoissa seuran pitää olla yksi rivi, ja lyhenne on se tunniste, jonka lukija tuntee.

## Päätös

Seura tunnistetaan virallisesta lyhenteestä. Aktiivisella seuralla lyhenne on yksilöllinen organisaation sisällä (v0.1: `'local'`). Tunnistusjärjestys: lyhenne, tarkka nimi, normalisoitu nimi, alias, sumea ehdotus (tokenin etuliite tai samankaltaisuus ≥ 0.9), muuten uusi seura.

Automaattisesti linkitetään vain lyhenne, nimi ja normalisoitu nimi. Sumea osuma, uusi seura ja lyhenneristiriita jäävät ihmisen vahvistettaviksi. Yhdistäminen siirtää osallistumiset, lisää aliaksen ja on peruttavissa korjauslokin perusteella. Samaa lyhennettä ei voi tallentaa toiseen aktiiviseen seuraan (`CLUB_ABBREVIATION_TAKEN`).

Haku: tarkka lyhenne ensin, sitten nimen tai aliaksen alku. Tyhjä haku ei palauta koko rekisteriä.

## Seuraukset

- Tuloksissa leveä näkymä näyttää koko nimen ja kapea (alle 600 px) lyhenteen.
- Jaettu pilvihakemisto (`org_id` tyhjä) on SaaS-ajan asia. Paikallinen rekisteri kertyy kisoista ja kulkee `.ertx`-viennissä.
