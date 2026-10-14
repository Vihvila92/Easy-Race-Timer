# ADR 0006: Henkilö, osallistuminen ja suostumus

- Tila: hyväksytty (v0.1)
- Päivä: 2026-10-14

## Tausta

Sama ihminen voi juosta useamman matkan, ja tulosrivi pitää voida julkaista vielä sen jälkeen, kun henkilötiedot on poistettu.

## Päätös

`person` on ihminen. `entry` on osallistuminen yhdelle matkalle: lappu, sarja, seura, status ja lähtösiirto. Lappu on yksilöllinen matkan sisällä.

Kisan toteutus (nimi, sarja, seura, tulos) ei käytä pitkäaikaista suostumusta. Pitkäaikainen tallennus on erillinen, vapaaehtoinen `consent`-rivi (`purpose = long_term_storage`) tekstiversiolla, antajalla (`self` tai `guardian`) ja kanavalla. Alle 13-vuotiaan antajaksi merkitään huoltaja. CSV-tuonti kirjoittaa valinnan jokaiselle riville.

## Seuraukset

- Anonymisointi katkaisee `entry.person_id`-linkin. Saman ihmisen kisoja ei voi yhdistää sen jälkeen.
- Suostumuksen antaneiden tiedot säilyvät.
- Rekisteröidyn vienti on `GET /api/v1/persons/:id/export`.
