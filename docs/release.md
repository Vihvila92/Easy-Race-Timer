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
gh attestation verify FILE --repo Vihvila92/Easy-Race-Timer
```

Replace `vX.Y.Z` with the tag and `FILE` with each installer (`.msi`, `.exe`, `.dmg`, `.AppImage`, `.deb`). The checksum command checks every file listed in `checksums.txt`. The attestation command fails when the file was not built by this repository's GitHub Actions.

A dry run uploads workflow artifacts only. Those artifacts are not a GitHub Release and do not have attestations. Check them with `sha256sum -c checksums.txt` from the `release-assets` artifact.

## Bill of materials and updater files

A tagged release also includes:

- `sbom-npm.cdx.json` — CycloneDX SBOM from the pnpm lockfile
- `sbom-cargo.cdx.json` — CycloneDX SBOM from `cargo cyclonedx` on `src-tauri/`
- `checksums.txt` — SHA-256 of every other asset
- `latest.json` and `.sig` files — Tauri updater metadata, when signing secrets are configured

Updater signatures need repository secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, plus the matching public key in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`) or in the secret `TAURI_SIGNING_PUBLIC_KEY`. Generate the pair with `pnpm tauri signer generate` and store only the private key as a secret. A dry run without those secrets still builds the installers.

The desktop window is still the web UI without the club server. The server sidecar is a later change.
