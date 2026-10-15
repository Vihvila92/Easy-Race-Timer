# ADR 0001: SQLite yhdellä kannettavalla

- Tila: hyväksytty (v0.1)
- Päivä: 2026-10-14

## Tausta

v0.1 ajetaan kisapaikalla yhdellä kannettavalla, ilman verkkoa. Vanha luonnos oletti Postgresin ja monivuokralaisuuden. Maalipainallusta ei saa hävitä, vaikka prosessi kaatuu.

## Päätös

Palvelin on yksi Node 22 -prosessi. Tietokanta on SQLite (`better-sqlite3`), `journal_mode=WAL` ja `synchronous=FULL`. Palvelin kuuntelee oletuksena vain `127.0.0.1`. Varmuuskopio otetaan viiden minuutin välein. Skeema on numeroitu (`schema_meta.schema_version`); uudempaa kantaa ei avata vanhemmalla sovelluksella, ja ennen migraatiota otetaan kopio.

Jokaisessa juuritaulussa on `org_id`. v0.1:ssä arvo on aina `'local'`. SQL pidetään siirrettävänä ja ajat INTEGER-millisekunteina, jotta sama skeema voidaan myöhemmin ajaa PostgreSQL:ään.

## Seuraukset

- Yksi komento käynnistää kisan. Selain avataan samalla koneella, joten PWA toimii ilman TLS-sertifikaattia.
- Kuitattu painallus on levyllä ennen HTTP-vastausta. Tämä testataan `kill -9`:llä.
- Lähiverkko ja Postgres eivät kuulu v0.1:een.
