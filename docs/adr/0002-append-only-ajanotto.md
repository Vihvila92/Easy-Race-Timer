# ADR 0002: Append-only-ajanotto

- Tila: hyväksytty (v0.1)
- Päivä: 2026-10-14

## Tausta

Maaliaika on todiste. Korjaus ei saa pyyhkiä alkuperäistä painallusta, ja sama painallus voi saapua uudestaan kaatumisen tai jonon jälkeen.

## Päätös

`timing_event`-rivit ovat lisäyksiä. Asiakas luo tunnisteen. Palvelin tallentaa `device_time_ms` muuttumattomana ja antaa laitteelle kasvavan `seq_no`. Sama `id` on idempotentti. Mitättömäksi merkitseminen, palautus, lapun vaihto ja ajan kopiointi ovat `correction`-rivejä, eivät päivityksiä tapahtumaan. Tulokset lasketaan päällekkäin: ensimmäinen mitätöimätön maaliaika miinus lähtö ja lähtösiirrot.

Muokattavissa riveissä on `rev` ja HLC-leima myöhempää synkronointia varten.

## Seuraukset

- Audit-loki on korjaustaulu. Syy on pakollinen.
- Lukittu kisa hylkää muutokset koodilla `EVENT_LOCKED`.
- Uudelleenlähetys kaatumisen jälkeen ei tuplaa aikaa.
