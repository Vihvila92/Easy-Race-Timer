# ADR 0009: Alustariippumaton API

- Tila: hyväksytty v0.1:n osalta
- Päivä: 2026-10-14

## Tausta

Myöhemmät iOS- ja Android-sovellukset käyttävät samaa palvelinta. Selain ei saa olla osa sopimusta.

## Päätös

REST on JSON `/api/v1`-polussa. Virhe on aina `{ error: { code, message, details? } }`. Tunnisteet ja maaliajat syntyvät asiakkaalla. Laitetunniste v0.1:ssä on paikallinen; PIN suojaa ylläpitotoimia. Evästeisiin ei sidota istuntoa.

WebSocket on `/ws`, protokollaversio 1. Synkronointitiedosto on `.ertx`. Sopimus on kuvattu tiedostoissa `docs/api/openapi.yaml`, `docs/api/ERROR_CODES.md` ja `docs/protocol/sync-v1.md`.

Tuloste-HTML (`GET /api/v1/results?format=html`) on viennin muoto, ei sovelluksen sivupohja. Muut vastaukset ovat JSON tai CSV.

## Seuraukset

- OpenAPI on kirjoitettu käsin v0.1:n reiteistä. Generointi `core`:n zod-skeemoista tehdään, kun skeemat kattavat kaikki rungot.
- `swift-openapi-generator` ja Kotlin-generaattori voidaan kytkeä samaan YAML-tiedostoon ilman palvelinmuutosta.
- Testikello `POST /api/v1/test/clock` on olemassa vain, kun `ERT_TEST_MODE=1`.
