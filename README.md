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

Open the address printed on the `ERT_READY` line. The developer server uses port 8080 and the `./data` folder. The UI is in Finnish and English, light and dark. With no race yet, the first screen is a three-step wizard. If the timing program cannot be reached, that screen explains it in the chosen language and offers Try again. A dev build reviews shared components at `#/preview`. That route is not in the production build.

`pnpm dev` starts the Vite UI with a proxy. That proxy is a development aid. The built UI does not contain a host or a port.

`pnpm start` with no variables behaves like the desktop shell: a free local port and the operating system user-data directory.

## Desktop app (Tauri)

`src-tauri/` is a Tauri 2 shell. On startup it spawns the Node server as a sidecar (`PORT=0`, `HOST=127.0.0.1`, `ERT_DATA_DIR` set to the operating system app data directory) and waits up to 20 seconds for one stdout line, `ERT_READY` plus JSON. It then opens the window at that `http://127.0.0.1:<port>` URL, so the UI and the API stay on the same origin. Closing the window stops the sidecar.

The shell plugin may spawn only `binaries/ert-server`, with no arguments. It cannot run other programs. If the sidecar fails or the ready line does not arrive, the window shows a static Finnish and English error page instead of a blank view.

Every response from that server, including HTML results, sends `Content-Security-Policy` (with `default-src 'self'`, `connect-src 'self'`, and `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`.

`pnpm build:sidecar` builds the web UI and packages `packages/server` as a Node 22 single executable, including the `better-sqlite3` prebuild for this machine. The file is `src-tauri/binaries/ert-server-<target-triple>` (`.exe` on Windows). It is not committed. `pnpm tauri build` runs that script first. The `check` job does not.

Requirements: Node.js 22 and Rust 1.90 or newer (`rust-toolchain.toml`; CI installs 1.90.0). On Linux also install `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `librsvg2-dev`, `patchelf`, and `libayatana-appindicator3-dev`. See the Tauri prerequisites guide for Windows and macOS.

```sh
pnpm install
pnpm rebuild better-sqlite3 esbuild
pnpm build:sidecar
pnpm tauri dev
pnpm tauri build --bundles appimage,deb   # Linux: AppImage + .deb
```

Bundle targets: Windows `msi` + `nsis`, macOS universal `dmg` (ad-hoc signed, not notarized), Linux `appimage` + `deb`. Installers have no paid Apple or Windows certificate. The Release workflow builds them and, for a `v*` tag, publishes the GitHub Release. The required `check` job does not build the sidecar or the installers. Verification, Gatekeeper and SmartScreen: [docs/release.md](docs/release.md). The updater (#136) is not part of this shell.

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
