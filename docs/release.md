# Release installers

English instructions for checking a download. Suomeksi: [release.fi.md](release.fi.md).

The Release workflow (`.github/workflows/release.yml`) builds the desktop app for three operating systems.

| How it starts | What you get |
|---|---|
| Actions → Release → Run workflow | A dry run. Installers are workflow artifacts. No GitHub Release is created. |
| A pushed `v*` tag, for example `v0.1.0` | A GitHub Release with the installers, updater files, checksums and SBOMs. |

Artifacts from a dry run are on the workflow run page, in `installers-linux`, `installers-macos`, `installers-windows` and the combined `release-assets` artifact. `release-assets` also contains `checksums.txt` and the two SBOMs.

## Packages

| System | Files |
|---|---|
| Windows | `.msi` and NSIS `.exe` |
| macOS | universal `.dmg`, ad-hoc signed (`signingIdentity` is `-`). Not notarized. |
| Linux | `.AppImage` and `.deb` |

Paid Apple notarization and a paid Windows certificate are not used. The installers are unsigned in that sense.

### macOS Gatekeeper

If macOS says the app cannot be opened because the developer cannot be verified, right-click the app and choose **Open**, then **Open** again.

### Windows SmartScreen

If Windows SmartScreen says the app is unrecognized, choose **More info**, then **Run anyway**.

## Check a tagged release

Install [GitHub CLI](https://cli.github.com/) for the attestation command. `sha256sum` is on Linux. On macOS, `shasum -a 256 -c checksums.txt` does the same check when `sha256sum` is not installed.

```sh
gh release download vX.Y.Z --repo Vihvila92/Easy-Race-Timer
sha256sum -c checksums.txt
gh attestation verify FILE \
  --repo Vihvila92/Easy-Race-Timer \
  --signer-workflow Vihvila92/Easy-Race-Timer/.github/workflows/release.yml \
  --source-ref refs/tags/vX.Y.Z
```

Replace `vX.Y.Z` with the tag and `FILE` with each installer (`.msi`, `.exe`, `.dmg`, `.AppImage`, `.deb`), each updater archive (`.tar.gz`, `.nsis.zip`, `.msi.zip`), each `.sig` file and `latest.json`. The checksum command checks every file listed in `checksums.txt`. The attestation command fails when the file was not built by this repository's Release workflow for that tag.

A dry run uploads workflow artifacts only. Those artifacts are not a GitHub Release and do not have attestations. Check them with `sha256sum -c checksums.txt` from the `release-assets` artifact.

## Bill of materials and updater files

A tagged release also includes:

- `sbom-npm.cdx.json` — CycloneDX SBOM from the pnpm lockfile
- `sbom-cargo.cdx.json` — CycloneDX SBOM from `cargo cyclonedx` on `src-tauri/`
- `checksums.txt` — SHA-256 of every other asset
- `latest.json` and `.sig` files — Tauri updater metadata for a tagged release
- unsigned updater archives on a dry run: `.app.tar.gz`, `.AppImage.tar.gz`, `.nsis.zip` and `.msi.zip`

## Updater signing

The public key is `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`. The committed value is the placeholder `TODO_REPLACE_WITH_UPDATER_PUBKEY` until the repository admin generates a key pair. CI does not read a public key from a secret or an environment variable, and it does not overlay a different key at build time.

The private key is not a repository secret. The installer jobs never receive it. They pack the updater archives without signatures. Only the `sign` job can read the private key. That job runs only when a `v*` tag is pushed, and only from the GitHub Environment named `release`. A dry run (`workflow_dispatch`, including one started from a tag) does not use that environment and does not sign.

The `sign` job does not install this repository's dependencies. It checks that the tag commit is contained in `main` (`git merge-base --is-ancestor "$GITHUB_SHA" origin/main`), rejects the placeholder public key, signs a nonce and checks it against the committed public key, then runs `tauri signer sign` on the updater archives. If a GitHub Release for that tag already exists, publish stops instead of replacing the assets.

### Settings the admin must create before the first tag

These are repository settings. The workflow cannot create them.

GitHub → Settings → Environments → New environment. Name it exactly `release`.

- Required reviewers: Valtteri (`Vihvila92`). A deployment waits until he approves it.
- Deployment branches and tags: Selected tags. Allow the tag name pattern `v*` only. Do not allow any branch.
- Environment secrets on `release` (not repository secrets):
  - `TAURI_SIGNING_PRIVATE_KEY` — the private-key string printed by `pnpm tauri signer generate`
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — that key's password, or an empty value when the key has no password
- Do not create a secret named `TAURI_SIGNING_PUBLIC_KEY`.

GitHub → Settings → Rules → New ruleset, targeted at tags:

- Name: `release-tags`
- Target: tags matching `v*`
- Restrict creations to repository admins (the maintainers)
- Block force pushes of those tags
- Block deletions of those tags

A tag that is not a commit on `main` still fails in the `sign` job, which is the check the ruleset does not do by itself.

Generate the key pair on a trusted machine, not in CI:

```sh
pnpm tauri signer generate -w "$HOME/.tauri/easy-race-timer.key"
```

Replace `TODO_REPLACE_WITH_UPDATER_PUBKEY` in `src-tauri/tauri.conf.json` with the public key that command prints. Put the private key only in the `release` environment. Do not commit the private key. The first `v*` tag fails the `sign` job until that placeholder is replaced and the environment above exists.

The desktop window is still the web UI without the club server. The server sidecar is a later change. The updater plugin itself is a later change; the key is committed now so release signatures are pinned in git.
