# ADR 0003: Modulaarinen monoliitti

- Tila: hyväksytty (v0.1)
- Päivä: 2026-10-14

## Tausta

Sama tuloslaskenta ja seurarekisteri tarvitaan kannettavalla, myöhemmin puhelimessa ja SaaS-palvelussa. Mikropalvelut olisivat kisapaikalla turha vikapinta.

## Päätös

Yksi prosessi, pnpm-monorepo. Rajat:

| Kerros | Paketit | Saa riippua |
|---|---|---|
| Ydin | `core` | ei mistään |
| Kieli | `i18n` | ei mistään |
| Infra | `people`, `storage`, `sync` | `core` |
| Laajennukset | `sports`, `timing-sources`, `race-formats`, `exporters` | `core`, `i18n` |
| Sovellus | `server`, `web` | kaikista alla olevista, ei toisistaan |

`server` on composition root. Laajennukset rekisteröidään `registry.register`. Domain-tapahtumat kulkevat prosessin sisäisellä väylällä. CI ajaa dependency-cruiserin näillä säännöillä.

Tuloslaskenta on puhdas funktio `computeResults`.

## Seuraukset

- Selainpaketti ei vedä SQLiteä. Palvelin ei tuo Reactia.
- Uusi laji tai vientimuoto on uusi moduuli, ei skeemamuutos.
- Ulkoinen plugin-rajapinta avataan aikaisintaan v1.x:ssä.
