# Easy Race Timer

Race timing for one laptop. v0.1 covers preparation, a mass start, finish recording, results and anonymization after the retention period. No network is required.

The specification (Finnish) is [`docs/MAARITTELY.md`](docs/MAARITTELY.md). Suomeksi: [`README.fi.md`](README.fi.md). Doc map: [`docs/README.md`](docs/README.md).

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

## Quick start for developers

You need Node.js 22 and pnpm 10.33. These commands are for developers. The club volunteer's path is a later installer, not a terminal. See [docs/roadmap.md](docs/roadmap.md).

```bash
pnpm install
pnpm rebuild better-sqlite3 esbuild
pnpm build
pnpm dev:server
```

Open the address printed on the `ERT_READY` line. The developer server uses port 8080 and the `./data` folder. The UI is in Finnish and English, light and dark. With no race yet, the first screen is a three-step wizard.

`pnpm dev` starts the Vite UI with a proxy. That proxy is a development aid. The built UI does not contain a host or a port.

`pnpm start` with no variables behaves like the future desktop shell: a free local port and the operating system user-data directory.

## Tests

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm e2e
```

`pnpm e2e` builds the UI and runs Playwright. The acceptance scenario is Kuulan hölkkä in [`testdata/kuulan-holkka/`](testdata/kuulan-holkka/).

## Roadmap

v0.1 is this repository. The next release a volunteer will see is a signed one-click installer. That installer is not built yet. [docs/roadmap.md](docs/roadmap.md). Decisions: [`docs/adr/`](docs/adr/).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues privately as described in [`SECURITY.md`](SECURITY.md).

## License and SaaS

The license is the root `LICENSE` file (the 2025 sports license). The specification recommends AGPL-3.0-only; that change waits for the copyright holder and is not applied here. The local app has no license keys and no feature limits. Billing, cloud relay and the runner portal are not in this repository.

Source: <https://github.com/Vihvila92/Easy-Race-Timer>
