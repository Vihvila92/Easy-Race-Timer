# @ert/web

React PWA for preparation, the finish and results.

Entry: `index.html` loads `src/main.tsx`. The package has no `exports` map. `pnpm --filter @ert/web dev` starts Vite, and `pnpm --filter @ert/web build` writes the UI.

From the repository root: `pnpm exec vitest run packages/web`. The browser run is `pnpm e2e`, described in [CONTRIBUTING.md](../../CONTRIBUTING.md).
