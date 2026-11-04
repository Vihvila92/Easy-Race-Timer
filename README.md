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

You need the Node.js and pnpm versions pinned in [CONTRIBUTING.md](CONTRIBUTING.md). These commands are for developers. The club volunteer's path is a later installer, not a terminal. See [docs/roadmap.md](docs/roadmap.md).

```bash
pnpm install
pnpm rebuild esbuild
pnpm build
pnpm dev:server
```

Open the address printed on the `ERT_READY` line. The developer server uses port 8080 and the `./data` folder. The UI is in Finnish and English, light and dark. With no race yet, the first screen is a three-step wizard. If the timing program cannot be reached, that screen explains it in the chosen language and offers Try again. A dev build reviews shared components at `#/preview`. That route is not in the production build.

`pnpm dev` starts the Vite UI with a proxy. That proxy is a development aid. The built UI does not contain a host or a port.

`pnpm dev:server` loads `config/dev.env`, which sets `ERT_DEV_KEY=1`. That opts in to a public development key. It is not for a real race. `pnpm start` does not load that file and refuses to open a race file until a data key is configured. With no variables it uses a free local port and the operating system user-data directory.

## Desktop app (Tauri)

`src-tauri/` is a Tauri 2 shell. On startup it clears the environment, then sets `HOST=127.0.0.1`, `PORT=0`, `ERT_DATA_DIR` (the operating system app data directory) and `NODE_ENV=production`. On Unix it also sets `LANG`. On Windows it keeps `SystemRoot` and `WINDIR` from the shell and leaves every other variable unset. The race file is SQLCipher. Until #131 wraps the data key, the desktop sidecar creates `desktop-data.key` (32 raw bytes, mode 0600) beside that file and does not read a key from the environment, argv, or `ERT_READY`. `pnpm start` has no such file and still refuses to open a race file. It writes a per-launch token to the sidecar's standard input. It waits up to 20 seconds for one stdout line, `ERT_READY` plus JSON. It then opens `http://127.0.0.1:<port>/auth?code=…`. That code is single-use. `/auth` answers `Cache-Control: no-store` and sets an HttpOnly session cookie (`ert_launch`, no `Max-Age` or `Expires`). The API and the websocket require the cookie or a bearer token. An unauthenticated `/ws` is HTTP 401 before the upgrade. The window has no shell or process API. Closing the window closes the sidecar's standard input, and the sidecar also exits if the shell process disappears.

Packaged interface files and the database module are stored in the app data directory and checked against SHA-256 hashes embedded in the sidecar. On Windows the per-user `%APPDATA%` directory is the boundary: the sidecar does not check the directory owner or mode there. Every launch still checks each extracted file's SHA-256 against the hashes embedded in the sidecar and replaces a file that does not match. A second instance focuses the existing window. The sidecar also holds an exclusive lock in the data directory while a launch token is set.

If the sidecar fails or the ready line does not arrive, the window shows a static Finnish and English error page instead of a blank view. The shell page's CSP is `default-src 'none'; style-src 'self'`.

Every response from that server, including HTML results, sends `Content-Security-Policy` (with `default-src 'self'`, `connect-src 'self'`, and `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`.

`pnpm build:sidecar` builds the web UI and packages `packages/server` as a Node 22.23.3 single executable. It compiles `better-sqlite3-multiple-ciphers` with that Node. On macOS the universal build compiles the module again for arm64 and for x64, and each slice's single-executable blob is produced by that architecture's Node binary (the x64 slice uses the x64 Node under Rosetta, not the arm64 Node). `lipo` joins the slices into `src-tauri/binaries/ert-server-universal-apple-darwin` and the result is ad-hoc signed. Tauri bundles the thin files `ert-server-aarch64-apple-darwin` and `ert-server-x86_64-apple-darwin`. Other targets write `src-tauri/binaries/ert-server-<target-triple>` (`.exe` on Windows). It is not committed. `pnpm tauri build` runs that script first. The `check` job does not. The Release workflow runs the same build, then prints `file` and `lipo -info` for the universal binary before it builds installers.

Requirements: Node.js 22.23.3 and Rust 1.90 or newer (`rust-toolchain.toml`; CI installs 1.90.0). On Linux also install `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `librsvg2-dev`, `patchelf`, and `libayatana-appindicator3-dev`. See the Tauri prerequisites guide for Windows and macOS.

```sh
pnpm install
pnpm rebuild esbuild
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

v0.1 is this repository. A tagged release publishes unsigned installers for Windows, macOS and Linux ([docs/release.md](docs/release.md)). Paid signing is not in use. The Node server ships inside the desktop app as a sidecar. [docs/roadmap.md](docs/roadmap.md). Decisions: [`docs/adr/`](docs/adr/).

## Contributing

Run `pnpm check:lean` before a pull request. Setup and the checklist are in [`CONTRIBUTING.md`](CONTRIBUTING.md). See also the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues privately as described in [`SECURITY.md`](SECURITY.md).

## License and SaaS

The software is licensed under the GNU Affero General Public License v3.0 (SPDX `AGPL-3.0-only`, see `LICENSE`). External contributors are asked to sign a CLA (see [CLA.md](CLA.md)). Commercial licensing: valtteri@vehvilainen.cc. The local app has no license keys and no feature limits. Billing, cloud relay and the runner portal are not in this repository.

Source: <https://github.com/Vihvila92/Easy-Race-Timer>
