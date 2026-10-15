# Contributing

Easy Race Timer v0.1 is a TypeScript monorepo (pnpm 10.33, Node.js 22). By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Language

Issues, pull requests, commit messages, code comments and technical documentation are written in English. User guides for clubs are written in both Finnish and English. The specification [`docs/MAARITTELY.md`](docs/MAARITTELY.md) is in Finnish.

## Workflow

1. Every change starts from an issue with acceptance criteria, a label and a milestone.
2. Work on a branch of your own, for example `feat/finish-undo` or `docs/install-guide`. Nobody pushes to `main` directly.
3. Open a pull request and fill in the pull request template. Add a `Closes #n` line for every issue the pull request fixes, so GitHub closes them on merge.
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

See [Strings and guided-mode hints](#strings-and-guided-mode-hints).

## Strings and guided-mode hints

Add every new user-visible string to both [`packages/i18n/locales/fi.json`](packages/i18n/locales/fi.json) and [`packages/i18n/locales/en.json`](packages/i18n/locales/en.json) in the same change. Placeholders use `{name}`. `pnpm check:i18n` fails when a key exists in one file but not the other, and when a key is both a leaf and a prefix of another key. Do not hard-code user-visible copy in a view.

Name keys `<view>.<element>` in camelCase, for example `finish.tap`. Shared, view-independent keys stay at the top level (`action.*`, `theme.*`, `lang.*`, `nav.*`). One extra level is only for an option set (`office.offset.ranked`, `entries.consent.yes`) or a guided-mode hint (`<view>.hint.<id>`, for example `finish.hint.keys`). A group label uses its own element name (`office.ageBasisTitle`) so it is not also the prefix of those options. A key ending in `Label` is an accessible name (`finish.tapLabel`), not the visible text.

The language switch lives in settings. Finnish is the default. The choice is stored in local storage and applies immediately. Only `fi` and `en` are accepted; any other stored value falls back to Finnish.

Guided mode is the default. A `<view>.hint.<id>` string is shown only while guided mode is on. Write the Finnish and English hint next to the other strings for that view. Do not put the hint sentence in the component.

Format dates and times with `formatDate`, `formatTime` and `formatDateTime` from `@ert/i18n` (`fi-FI` and `en-GB`). A Finnish date looks like `15.10.2026`. Store a calendar date as `YYYY-MM-DD`.

## User interface

Shared controls live in [`packages/web/src/ui`](packages/web/src/ui). Use them for new views: `Button` (primary, secondary, danger), `TextField`, `Select`, `Banner`, `ListRow`, `StatusBadge`, `Clock` and `HintFrame`. Colors, type and spacing are CSS variables on `:root`. `[data-theme="dark"]` replaces them. The theme follows the system setting until the user chooses light or dark. Targets are at least 44 by 44 px, and both themes meet WCAG 2.2 AA contrast.

`HintFrame` renders a `<view>.hint.<id>` string in the page flow only while guided mode is on. It is not a dialog. A dev build reviews the set at `#/preview`. That route is not part of the production build.

## Data and timing

Finish taps are append-only. Corrections carry a reason. Do not update a stored `device_time_ms`.

The Kuulan hölkkä oracle lives in `testdata/kuulan-holkka/generate.py`. Change the scenario there and regenerate; do not hand-edit expected CSV files.

## Personal data and secrets

- Use only synthetic test data (`testdata/`, the Kuulan hölkkä generator). Never put real names, birth dates or results of participants, especially minors, into issues, fixtures, screenshots or logs.
- Never commit tokens, keys, passwords, `.env` files or real participant data. Secret scanning with push protection is on. If a push is blocked, remove the secret and rotate it; do not bypass the block. If a secret was committed, report it privately: rotation matters more than rewriting history.

## Dependencies and GitHub Actions

- Add a dependency only when it is needed, and explain why in the pull request.
- Commit the updated `pnpm-lock.yaml`; do not hand-edit it.
- Licenses must pass `pnpm check:licenses`.
- Prefer maintained, widely used packages, and avoid install scripts unless they are required.
- Dependabot pull requests are reviewed like any other pull request.
- Pin every action to a full commit SHA with a version comment (e.g. `actions/checkout@<sha> # v7.0.1`); tags such as `@v4` are not allowed. Dependabot updates the SHA and comment together. Declare a minimal `permissions:` block in every workflow (default `contents: read`).

## Security-sensitive changes

Changes to authentication (PIN, tokens), consent, publication levels, anonymization and retention, import and export, sync or rate limiting need a test and a note in the pull request description, so the security reviewer can look at them. CodeQL alerts of high severity or above block merging; do not dismiss an alert without review.

`git commit -s` (DCO sign-off) and GPG or SSH signed commits are welcome but not required.

## License

The project is licensed under `AGPL-3.0-only` (see `LICENSE`). External contributors must sign the Contributor License Agreement ([CLA.md](CLA.md)) before their pull request can be merged; the CLA assistant bot guides you in the PR by asking you to comment `I have read the CLA Document and I hereby sign the CLA`. Do not submit code you cannot license under these terms.

## Security

Report vulnerabilities privately through GitHub's [Report a vulnerability](https://github.com/Vihvila92/Easy-Race-Timer/security/advisories/new) form or by email, as described in [`SECURITY.md`](SECURITY.md). Do not open a public issue, pull request or discussion for them.
