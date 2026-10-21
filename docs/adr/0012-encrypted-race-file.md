# ADR 0012: Encrypted race file

- Status: accepted for phase 1
- Date: 2026-10-21
- Supersedes the plain-file claim in [ADR 0001](0001-sqlite-ja-kannettava.md). WAL, `synchronous=FULL` and one local process stay as decided there.

## Context

The race file holds names, emails, consent and, later, user accounts. A USB copy or a backup must not be readable before the operator unlocks it. Key wrapping is a later issue. This decision only covers the file format, the cipher, and how a migration or a save survives a crash.

## Decision

One file, `ert.sqlite`, is a SQLCipher database opened with `better-sqlite3-multiple-ciphers` 13.0.3 (MIT, SQLite 3.53.4, SQLite3 Multiple Ciphers 2.4.0). The package ships prebuilt binaries. The app does not compile SQLCipher in CI.

The cipher is pinned before the key is set:

| Pragma | Value |
|---|---|
| `cipher` | `sqlcipher` |
| `legacy` | `4` (SQLCipher 4) |
| `legacy_page_size` | `4096` |
| `kdf_iter` | `256000` |
| `hmac_use` | `1` (page HMAC on) |
| `kdf_algorithm` | `2` (SHA-512) |
| `hmac_algorithm` | `2` (SHA-512) |
| `plaintext_header_size` | `0` |

The data key is 32 raw bytes, passed as a hex `PRAGMA key`. It is not a passphrase, so the passphrase KDF does not stretch it. `kdf_iter` stays at the SQLCipher 4 default so a future passphrase key uses the same page format. Page HMAC is what authenticates the file. `temp_store=MEMORY`. Journal mode stays WAL and `synchronous=FULL`; the WAL is encrypted with the same key.

`:memory:` databases stay unencrypted so existing unit tests keep working. Every file database is encrypted. `openDatabase` uses the dev key when `NODE_ENV` is not `production`. `openDataFile(path, dataKey)` is the explicit-key API.

The dev key is a fixed low-entropy buffer for development and tests. It is not a secret. Production refuses it, including when the caller passes those bytes or sets a flag. A different 32-byte key is allowed in production. Real wrapping of that key is out of scope.

A wrong key and a tampered file both surface as one error: the file name, no directory, no key bytes and no stack. A schema newer than this app is a separate, friendly error in Finnish and English, with the guided hint `file.hint.newer`. The file is left unchanged.

Existing plaintext `ert.sqlite` files are not converted. They fail to open. This is pre-1.0; delete the file and create the race again.

### Migration and backups

Opening an older encrypted file peeks the schema version read-only, then copies the bytes to `<file>.v<old>.bak`. The backup is byte-identical to the file before the migration and does not open with plain `sqlite3`. If that copy fails, migration does not start.

Migration runs on `<dir>/.basename.migrating`: schema statements, ordered migrations, version update, `wal_checkpoint(TRUNCATE)`, fsync, then an atomic rename over the original and a directory fsync where the OS allows it. The file and the backup are mode `0600` on macOS and Linux. A failure before the rename deletes the temp file and leaves the original byte-identical.

Scheduled backups checkpoint the WAL and copy the encrypted main file. They do not use the SQLite backup API, which would write plaintext. A crash during an ordinary save leaves the last committed transaction. Uncommitted work is discarded.

### Schema 4

The same file holds race data, the consent log, the correction audit log, `user_account` and `key_slot`. No wrapped key material is written yet.

`person` stores `birth_year` only. A migration copies the year out of `birth_date` and drops that column. A full date may exist in memory during CSV preview or registration and is then discarded. `entry.consent_date` is `NOT NULL`; the server sets it from the registration clock. `entry.dsq_reason` is internal. Results CSV, print HTML, person export and `.ertx` entry rows omit it. The correction log may still store the same text as the audit reason.

## Consequences

- A copy of the file on a USB stick is ciphertext. Plain `sqlite3` cannot open it.
- Tests assert the pinned cipher settings after open, and they assert that a known name and email are absent from the raw bytes.
- Power loss is tested by `SIGKILL` during migration and during an uncommitted save.
- Later issues wrap the data key. They must not change this page format.
