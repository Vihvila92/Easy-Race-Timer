# Contributing

Easy Race Timer v0.1 is a TypeScript monorepo (pnpm, Node 22).

## Local checks

```bash
pnpm install
pnpm rebuild better-sqlite3 esbuild
pnpm lint
pnpm depcruise
pnpm check:i18n
pnpm check:licenses
pnpm typecheck
pnpm test
pnpm e2e
```

Module boundaries are enforced by dependency-cruiser. `core` and `i18n` do not import other workspace packages. The web app does not import the server or SQLite.

Add Finnish and English strings together. `pnpm check:i18n` fails if a key is missing.

## Data and timing

Finish taps are append-only. Corrections carry a reason. Do not update a stored `device_time_ms`.

The Kuulan hölkkä oracle lives in `testdata/kuulan-holkka/generate.py`. Change the scenario there and regenerate; do not hand-edit expected CSV files.

## License

The root `LICENSE` stays as it is until the copyright holder decides otherwise. Do not add SPDX headers that claim AGPL. A contributor license agreement is not in use yet; it belongs with that license decision.

## Security

Report vulnerabilities privately. See `SECURITY.md`. Do not open a public issue for them.
