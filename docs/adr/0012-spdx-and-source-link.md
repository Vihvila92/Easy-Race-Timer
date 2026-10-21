# ADR 0012: SPDX headers and a versioned source link

- Status: accepted
- Date: 2026-10-21

## Context

The project is AGPL-3.0-only. ADR 0005, still a proposal, said not to add SPDX headers. The license notice in the interface has to offer the source of the version that is running (AGPL §13), not only the repository home. Restricted race mode (#134) is not implemented. The source link still has to stay on screen in every shell that exists today, including the PIN gate, so a later race mode does not drop it by hiding navigation.

## Decision

Every source file carries `SPDX-License-Identifier: AGPL-3.0-only` in its first lines. Source files are `.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`, `.css`, `.py`, `.html` and `.rs`. A shebang stays on the first line and the header follows it. `pnpm check:spdx` fails when a source file is missing that header. JSON, Markdown and lockfiles are not source files.

The web build injects the git tag when HEAD is exactly that tag, otherwise the full commit. The footer and the About view link to that revision. They do not link to the repository home. About shows the version, the revision, the source link and a short AGPL notice in Finnish and English.

## Consequences

- The sentence in ADR 0005 that SPDX headers are not added no longer applies.
- A build that cannot resolve a tag or a commit fails, instead of publishing a link to the repository home.
