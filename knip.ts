// SPDX-License-Identifier: AGPL-3.0-only
// Allowlist for findings that are false positives or that stay until a file
// already over the complexity limit can be split. Each entry says why.
const config = {
  // main.tsx registers this script by the URL /sw.js. It is not imported.
  // The Kuulan spec under testdata is a draft scenario beside the oracle, not a suite entry.
  // Cargo writes src-tauri/target. It is gitignored build output, not a source file.
  ignore: ['packages/web/public/sw.js', 'testdata/**', 'src-tauri/target/**'],
  // node-gyp is loaded by path from scripts/build-sidecar.ts.
  // postject is started with `pnpm exec postject` from that same script.
  // jscpd is started from scripts/check-duplication.ts via createRequire, which knip does not follow.
  ignoreDependencies: ['node-gyp', 'postject', 'jscpd'],
  // Operating-system tools used by the sidecar build, cipher tests, and desktop smoke.
  ignoreBinaries: ['sqlite3', 'rustc', 'file', 'arch', 'lipo', 'pgrep', 'tasklist', 'hdiutil', 'xattr'],
  ignoreIssues: {
    // parseHost is used only in this module. The file is over the complexity limit.
    'packages/server/src/guard.ts': ['exports'],
    // ERTX_TABLES and ErtxTable are used only in this module. The file is over the complexity limit.
    'packages/server/src/ertx-import.ts': ['exports', 'types'],
    // CsvEntry is the private shape of the CSV importer. The file is over the size limit.
    'packages/server/src/service.ts': ['types'],
    // RateLimitSettings is the options shape of createApp. The file is over the size limit.
    'packages/server/src/app.ts': ['types'],
    // The recognized name, immutable URI, and quarantine directory are used only in this module.
    'packages/storage/src/plaintext.ts': ['exports'],
    // ensurePrivateDirectory is re-exported for the sidecar and safeJoin is used here.
    // The file is over the complexity limit.
    'scripts/sidecar-assets.ts': ['exports'],
  },
}

export default config
