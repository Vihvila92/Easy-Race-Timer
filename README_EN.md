# Easy Race Timer

Race timing for one laptop. v0.1 covers preparation, a mass start, finish recording, results and anonymization after the retention period. No network is required.

The specification (Finnish) is [`docs/MAARITTELY.md`](docs/MAARITTELY.md). Suomeksi: [`README.md`](README.md). Doc map: [`docs/README.md`](docs/README.md).

## Repository

```
packages/core            results, categories, errors
packages/people          clubs, consent, anonymization
packages/i18n            Finnish and English
packages/sports          running profile
packages/timing-sources  touch finish
packages/race-formats    mass start
packages/exporters       CSV and A4 print
packages/storage         SQLite
packages/sync            .ertx
packages/server          Fastify, composition root
packages/web             React PWA
e2e/                     Playwright, Kuulan hölkkä
testdata/kuulan-holkka/  oracle
```

The 2025 Postgres draft exists only on the tag `legacy-2025`.

## Quick start

Node.js 22 and pnpm 10.33.

```bash
pnpm install
pnpm rebuild better-sqlite3 esbuild
pnpm dev
```

In a second terminal:

```bash
pnpm start
```

Open `http://127.0.0.1:8080`. The UI is in Finnish and English, light and dark. The finish screen requests a wake lock, and the finish button fills at least a third of the screen.

One process for a race day:

```bash
pnpm build
ERT_DB=./data/ert.sqlite pnpm start
```

The server listens on localhost only (`HOST`, `PORT`). Storage is SQLite with WAL and `synchronous=FULL`. A backup is written every five minutes.

## Tests

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm e2e
```

`pnpm e2e` builds the UI and runs Playwright. The acceptance scenario is Kuulan hölkkä in [`testdata/kuulan-holkka/`](testdata/kuulan-holkka/).

## Roadmap

| Milestone | Contents |
|---|---|
| M0–M2 | Monorepo, preparation, timing, results, anonymization |
| M3 | The load test is included. The rehearsal and the real race happen on site. |
| v0.2 | Several devices, splits, LAN sync |
| v0.4 | SaaS beta in a separate repository |
| v1.x | Native apps and a runner portal |

Decisions: [`docs/adr/`](docs/adr/).

## License and SaaS

The license is the root `LICENSE` file (the 2025 sports license). The specification recommends AGPL-3.0-only; that change waits for the copyright holder and is not applied here. The local app has no license keys and no feature limits. Billing, cloud relay and the runner portal are not in this repository.

Source: <https://github.com/Vihvila92/Easy-Race-Timer>
