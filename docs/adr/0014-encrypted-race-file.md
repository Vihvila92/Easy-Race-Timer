# ADR 0014: Encrypted race file

- Status: accepted for phase 1
- Date: 2026-10-21
- Supersedes the plain-file claim in [ADR 0001](0001-sqlite-ja-kannettava.md). WAL, `synchronous=FULL` and one local process stay as decided there.

## Context

The race file holds names, emails, consent and, later, user accounts. A USB copy or a backup must not be readable before the operator unlocks it. Key wrapping is a later issue. This decision only covers the file format, the cipher, and how a migration or a save survives a crash.

## Decision

One file, `ert.sqlite`, is a SQLCipher database opened with `better-sqlite3-multiple-ciphers` 13.0.3 (MIT, SQLite 3.53.4, SQLite3 Multiple Ciphers 2.4.0). The package ships prebuilt binaries for development and tests. The desktop sidecar release build compiles the module again for each target architecture, including both macOS slices.

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

The data key is 32 raw bytes. Callers, including the later key-management unlock, pass that buffer to `openDataFile(path, dataKey)`. Storage is the only code that builds the SQLCipher statement, and it builds it only as:

```text
PRAGMA key = "x'<hex>'"
```

`<hex>` is exactly `dataKey.toString('hex')`: 64 lowercase hex digits. Nothing else is concatenated. `PRAGMA rekey` uses the same form. This is SQLCipher's raw-key syntax. The passphrase KDF does not run on top of those 32 bytes. `kdf_iter` stays at the SQLCipher 4 default so a future passphrase key would use the same page format. `Database#key(Buffer)` and `Database#rekey(Buffer)` are not used: this binding treats a buffer as a passphrase. SQL tracing is not enabled, so the pragma text is not written to a log.

SQLCipher 4 already gives each page its own random 16-byte IV, stored in the reserve and regenerated on write, plus an HMAC-SHA512 over the ciphertext and the IV (`hmac_use=1`, `hmac_algorithm=2`). This decision does not change that IV or add a GCM body or 64 KiB chunks. `plaintext_header_size=0`. The database starts at offset 0, where the first 16 bytes are the SQLCipher salt. There is no custom header in front of the file. A prefix would need a custom VFS, which this app does not add.

Page HMAC is what authenticates the file. `temp_store=MEMORY`. Journal mode stays WAL and `synchronous=FULL`; the WAL is encrypted with the same key.

`:memory:` databases stay unencrypted so existing unit tests keep working. Every file database is encrypted. `openDataFile(path, dataKey)` is the explicit-key API. There is no implicit key.

The dev key is a fixed low-entropy buffer for development and tests. It is not a secret. `openDatabase` uses it only when `NODE_ENV` is `development` or `test` and `ERT_DEV_KEY=1`. Any other environment, including an unset `NODE_ENV` and production, refuses to open a file until the caller passes a 32-byte data key. Production also refuses the dev key bytes themselves. A warning is written the first time the dev key is used. The process fills that key buffer with zeros when the database handle closes. Real wrapping of the data key is out of scope.

A wrong key and a tampered file both surface as one error: the file name, no directory, no key bytes and no stack. A missing key is a separate clear error. A schema newer than this app is a friendly error in Finnish and English, with the guided hint `file.hint.newer`. The file is left unchanged.

A plaintext `ert.sqlite` is encrypted with the configured data key. The encrypted copy is written to `<file>.encrypting`, fsynced, and checked with `PRAGMA integrity_check`. The original is then renamed to `<file>.plaintext-old`, the encrypted copy is renamed into place, and the directory is fsynced. Only after that is the set-aside original overwritten with zeros where the filesystem allows, then unlinked. Indexes, triggers and views are copied with the tables. If startup finds `.encrypting` or `.plaintext-old` left by a crash, it restores a consistent file and prefers the plaintext original when the encrypted target is missing or fails its integrity check. A leftover `.encrypting` whose integrity check passes is promoted only when the target file is missing and there is no plaintext original. The same recovery accepts the older `.ert.sqlite.encrypting` name.

Other plaintext files are not deleted. Startup moves a file only when its name is one this app creates (`ert*.sqlite` in the data directory, `ert-*.sqlite` in `backups/`, `*.premigrate.sqlite`, `*.premigrate-*.sqlite`, or a `<file>.sqlite.vN.bak`) and the original file, opened in place by the SQLCipher binding with no key as `file:<path>?mode=ro&immutable=1`, has a `schema_meta` table. The binding accepts that URI because the process sets `SQLITE_USE_URI=1` before the addon loads. The check does not copy the file and does not use another SQLite library. The scan uses `lstat` and skips symlinks, including a `backups` directory that is itself a link. The file and its `-wal`/`-shm` sidecars are renamed into `plaintext-quarantine/` (mode `0700`). The move sets the file mtime, which is the time it entered quarantine.

`GET /api/v1/health` sets `plaintextQuarantine` from whether that directory is non-empty, including after a restart. `POST /api/v1/plaintext-quarantine/delete` requires a JSON body `{ "confirm": true }` and otherwise returns 400 without deleting. On success it overwrites each quarantined file where the filesystem allows, unlinks it, and fsyncs the directory, then writes one correction row `plaintext_quarantine_delete` whose reason and new value are the count of files. That row does not contain file names. A symlink in the directory is unlinked and not followed. Startup also removes a quarantined file whose mtime is older than 30 days and logs the basename. On SSDs and copy-on-write filesystems (APFS, btrfs) the overwrite does not prove the old bytes are gone. A file that does not match, such as another program's `notes.sqlite`, is not opened and is not moved.

An unrecoverable plaintext leftover is `RaceFileError` kind `open`. The operator text is `file.openFailed` plus `file.hint.openFailed`, in Finnish and English, with the basename only.

### Key file seam

`ert.sqlite` pairs with `ert.keys` in the same directory. Another database basename pairs the same way (`club.sqlite` and `club.keys`). The database has no `key_slot` table. Wraps cannot live inside the body, because that table would be unreadable before unlock.

Until #131, `ert.keys` is a 24-byte stub, not the 320-byte `ERTK` envelope. The stub magic is `ERTS`, version 0, then the 16-byte `file_id`. It holds no data key, no salt, no nonce and no slot. `schema_meta.file_id` stores the same 16 bytes as 32 lowercase hex digits. The id is not secret. It is created once and stays the same across migration and rekey. An `ERTK` file is left untouched; #131 owns that format and checks the id after unwrap. A stub or envelope whose id does not match the database is refused, and it is not rewritten.

### Migration and backups

A backup is the database and the key file from the same moment. The write order is fixed:

1. `wal_checkpoint(TRUNCATE)` on the source when it is open, and before a migration copy when a WAL file is already present.
2. Atomic copy of the database (temp file, fsync, mode `0600`, rename).
3. Atomic copy of the key file, same way.
4. Fsync of the destination directory.

A crash before step 3 leaves a database with no key file. `restoreBackupPair` skips that pair and does not write the destination. A key file that is shorter than a stub, or shorter than a 320-byte envelope, is the same kind of incomplete pair and is skipped.

Opening an older encrypted file peeks the schema version read-only, then copies the database to `<file>.v<old>.bak` and the key file to `<file>.v<old>.keys` (`ert.sqlite.v3.bak` with `ert.sqlite.v3.keys`). Migration does not start unless both copies succeed. Until the migration commits, the database copy is byte-identical to the file and does not open with plain `sqlite3`. A failed backup removes both new copies.

Migration runs on `<dir>/.basename.migrating` with `secure_delete=ON`: schema statements, ordered migrations, version update, `VACUUM`, `wal_checkpoint(TRUNCATE)`, fsync, then an atomic rename over the original and a directory fsync where the OS allows it. `VACUUM` runs outside the migration transaction so a dropped `birth_date` is not left on a free page. After the rename, a `.vN.bak` that still has `birth_date` is rewritten without that column and vacuumed. If that rewrite fails, the backup pair is overwritten and deleted. A `.vN.bak` that never stored a birth date stays byte-identical. The files are mode `0600` on macOS and Linux. A failure before the rename deletes the temp file and leaves the original byte-identical.

Pre-migration backups are deleted once they are older than the event retention period. The next successful scheduled backup prunes the pair together. They are not kept forever. A key file whose database backup is still inside the retention period is kept.

Scheduled backups and USB copies use the same order. A stamped backup `ert-<stamp>-<reason>.sqlite` pairs with `ert-<stamp>-<reason>.keys`. Backups do not use the SQLite backup API, which would write plaintext. A crash during an ordinary save leaves the last committed transaction. Uncommitted work is discarded.

### Schema 4

The same file holds race data, the consent log, the correction audit log and `user_account`. It does not hold key slots. A draft file that still has an empty `key_slot` table drops that table on the next open. `schema_meta.file_id` is the bind point for the sidecar, and it is distinct from `installation_id`.

`person` stores `birth_year` only. A migration copies the year out of `birth_date` and drops that column, then vacuums. A full date may exist in memory during CSV preview or registration and is then discarded. `entry.consent_date` is `NOT NULL`; the server sets it from the registration clock. `entry.dsq_reason` is internal. Results CSV, print HTML, person export, the public results API and the WebSocket allow-list omit it. A DSQ status writes the fixed audit reason `set_status:dsq`. `.ertx` snapshots also rewrite any older `set_status` row whose new value is `dsq`, so the free-text reason does not leave in the archive. The live correction row can still hold that text for the operator on this computer.

### Rekey

`rekeyDataFile(db, newKey)` rotates the raw 256-bit data key on a copy. The live file is not rekeyed in place. SQLite3 Multiple Ciphers does not support `PRAGMA rekey` while the database is in WAL mode.

The helper checkpoints the live WAL with `TRUNCATE`, copies the database to `.<basename>.rekey`, and opens that copy with the current key. The copy is switched to `journal_mode=DELETE`, rekeyed with `rekey = "x'" + newKey.toString('hex') + "'"`, checked with `PRAGMA integrity_check` (must be `ok`), switched back to WAL, checkpointed, closed and fsynced. The key file is copied to `.<basename>.keys.rekey` and fsynced. This copy is still the stub. #131 replaces that step with a new envelope. `file_id` is not changed. If any step fails before the rename, the temps are removed and the original pair stays.

The database temp is then renamed over the database, the directory is fsynced, the key temp is renamed over the key file, and the directory is fsynced again. The open handle is closed and reopened on the new file, and the in-memory key buffer is the new key. A crash before either rename leaves the original pair; the next open deletes the temps. A crash after the database rename leaves the key temp; the next open attaches it only when its `file_id` matches. The stub does not contain the new data key, so a crash in that window can be finished only when the caller still has the new key. #131's envelope is what makes that restart unwrap on its own.

Do not rekey to the dev key unless the same dev-key opt-in applies. Production refuses those bytes.

## Consequences

- A copy of the file on a USB stick is ciphertext. Plain `sqlite3` cannot open it.
- Tests assert the pinned cipher settings after open, and they assert that a known name and email are absent from the raw bytes.
- Power loss is tested by `SIGKILL` during migration, during an uncommitted save, and after each step of plaintext encryption.
- `file_id` stays the same across rekey. Restart after a rekey still depends on the caller holding the new key, or on the key-file slot once #131 writes it. The stub does not unwrap a new key by itself.
- #131 replaces the `ERTS` stub with the `ERTK` envelope in the same path, checks `file_id` after unwrap, and writes the new envelope during rekey instead of copying the stub. It keeps this page format, keeps the database at offset 0, and keeps backup pairs in this order.
