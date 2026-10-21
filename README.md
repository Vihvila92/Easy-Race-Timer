# Easy Race Timer

Race timing for one laptop. v0.1 covers preparation, a mass start, finish recording, results and anonymization after the retention period. No network is required.

The specification (Finnish) is [`docs/MAARITTELY.md`](docs/MAARITTELY.md). Suomeksi: [`README.fi.md`](README.fi.md). Doc map: [`docs/README.md`](docs/README.md).

## Repository

```
packages/core            results, categories, errors
packages/people          clubs, consent, anonymization
packages/i18n            Finnish and English (`locales/fi.json`, `locales/en.json`)
packages/sports          running profile
packages/timing-sources  touch finish
packages/race-formats    mass start
packages/exporters       CSV and A4 print
packages/storage         encrypted SQLite (SQLCipher)
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
pnpm rebuild esbuild
pnpm build
pnpm dev:server
```

Open the address printed on the `ERT_READY` line. The developer server uses port 8080 and the `./data` folder. The UI is in Finnish and English, light and dark. With no race yet, the first screen is a three-step wizard. If the timing program cannot be reached, that screen explains it in the chosen language and offers Try again. A dev build reviews shared components at `#/preview`. That route is not in the production build.

`pnpm dev` starts the Vite UI with a proxy. That proxy is a development aid. The built UI does not contain a host or a port.

`pnpm dev:server` loads `config/dev.env`, which sets `ERT_DEV_KEY=1`. That opts in to a public development key. It is not for a real race. `pnpm start` does not load that file and refuses to open a race file until a data key is configured.

## Desktop app (Tauri, developer preview)

`src-tauri/` is a minimal Tauri 2 shell around the built web UI (`packages/web/dist`). It has no custom commands and only the `core:default` permission. The Node server sidecar (ADR 0010) and the updater (#136) come later, so the desktop window shows the UI without a backend for now.

Requirements: Rust 1.90 or newer (CI installs 1.90.0) and, on Linux, `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `librsvg2-dev`, `libayatana-appindicator3-dev`. See the Tauri prerequisites guide for Windows and macOS.

```sh
pnpm install
pnpm tauri dev                            # window with Vite hot reload
pnpm tauri build --bundles appimage,deb   # Linux: AppImage + .deb
```

Bundle targets: Windows `msi` + `nsis`, macOS universal `dmg` (ad-hoc signed, not notarized), Linux `appimage` + `deb`. Installers have no paid Apple or Windows certificate. The Release workflow builds them and, for a `v*` tag, publishes the GitHub Release. The required `check` job does not build installers. Verification, Gatekeeper and SmartScreen: [docs/release.md](docs/release.md).

## Tests

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm e2e
```

`pnpm e2e` builds the UI and runs Playwright. The acceptance scenario is Kuulan hölkkä in [`testdata/kuulan-holkka/`](testdata/kuulan-holkka/).

## Roadmap

v0.1 is this repository. A tagged release publishes unsigned installers for Windows, macOS and Linux ([docs/release.md](docs/release.md)). Paid signing and the server sidecar are still later. [docs/roadmap.md](docs/roadmap.md). Decisions: [`docs/adr/`](docs/adr/).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues privately as described in [`SECURITY.md`](SECURITY.md).

## License and SaaS

The software is licensed under the GNU Affero General Public License v3.0 (SPDX `AGPL-3.0-only`, see `LICENSE`). External contributors are asked to sign a CLA (see [CLA.md](CLA.md)). Commercial licensing: valtteri@vehvilainen.cc. The local app has no license keys and no feature limits. Billing, cloud relay and the runner portal are not in this repository.

Source: <https://github.com/Vihvila92/Easy-Race-Timer>
