# Contributing

Easy Race Timer v0.1 is a TypeScript monorepo (pnpm 10.33, Node.js 22). By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Language

Issues, pull requests, commit messages, code comments and technical documentation are written in English. User guides for clubs are written in both Finnish and English. The specification [`docs/MAARITTELY.md`](docs/MAARITTELY.md) is in Finnish.

## Workflow

1. Every change starts from an issue with acceptance criteria, a label and a milestone.
2. Work on a branch of your own, for example `feat/finish-undo` or `docs/install-guide`. Nobody pushes to `main` directly.
3. Open a pull request that links the issue (`Closes #123`) and fill in the pull request template.
4. The pull request needs green required checks (`check` and CodeQL), a review and resolved conversations. A maintainer squash-merges it.
5. Update the documentation in the same pull request as the change. Record architectural decisions as an ADR in [`docs/adr/`](docs/adr/).

## Commit messages and versions

Commit messages and pull request titles follow [Conventional Commits](https://www.conventionalcommits.org/), for example `feat(core): add tie-break by chip time` or `fix(web): keep focus after undo`. Versions follow [Semantic Versioning](https://semver.org/), and each release has a changelog entry.

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

## Personal data

Test data and screenshots must not contain real people's personal data. Use the generated test data in `testdata/`.

## License

The root `LICENSE` stays as it is until the copyright holder decides otherwise. Do not add SPDX headers that claim AGPL. A contributor license agreement is not in use yet; it belongs with that license decision.

## Security

Report vulnerabilities privately through GitHub's **Report a vulnerability** form, as described in [`SECURITY.md`](SECURITY.md). Do not open a public issue for them.
