# ADR 0013: Key management for the encrypted race file

- Status: proposed. Implementation of [#131](https://github.com/Vihvila92/Easy-Race-Timer/issues/131) starts only after Santtu approves the spec on that issue. This ADR is not that approval.
- Date: 2026-10-21
- Spec: [../spec/key-management.md](../spec/key-management.md)
- Number: 0013. The encrypted race file is [ADR 0014](0014-encrypted-race-file.md), merged from [#175](https://github.com/Vihvila92/Easy-Race-Timer/pull/175). Number 0012 is SPDX headers and the versioned source link.

## Context

Issue [#130](https://github.com/Vihvila92/Easy-Race-Timer/issues/130) and pull request [#175](https://github.com/Vihvila92/Easy-Race-Timer/pull/175) store every race in one SQLCipher file (`ert.sqlite`) encrypted with one random 256-bit data key (DEK). The database starts at byte 0. SQLCipher 4 gives each page write a random IV and an HMAC-SHA512. Issue [#131](https://github.com/Vihvila92/Easy-Race-Timer/issues/131) is the real key handling: the DEK must never be written unwrapped, two admins must each be able to open the file, and a printed recovery key must open it if both passwords are lost.

The wraps cannot live in a header in front of `ert.sqlite`. SQLCipher and SQLite3 Multiple Ciphers expect the salt and page 1 at offset 0, and they do not take a byte offset without a custom VFS. The wraps also cannot live in the `key_slot` table inside the database: that table is unreadable before unlock. They live in a sidecar key file.

The club's copy of the data is the database and the key file together, on the laptop and on USB backups. A person who picks up that stick must not be able to read names, birth years, consents or results. A former admin who kept an old copy is a different case from a stranger, and a password change on the current key file does not reach that old copy.

Santtu's review on [#131](https://github.com/Vihvila92/Easy-Race-Timer/issues/131#issuecomment-6308842611) requires this ADR to record the slot format and the threat model: what an attacker with the USB stick can and cannot do. The byte layout below is normative. Procedures, KDF limits, backoff, tests and the bilingual recovery guide are normative in the spec. Change both documents in the same pull request.

## Decision

One current database holds one DEK. The DEK is 32 bytes from a CSPRNG (`crypto.randomBytes` or libsodium `randombytes_buf`). It is passed to SQLCipher as a raw key, in the hex pragma form [#175](https://github.com/Vihvila92/Easy-Race-Timer/pull/175) already uses:

`key = "x'" + dek.toString('hex') + "'"`

`PRAGMA rekey` uses the same quoting. The statement is built only from that hex. It is not a passphrase, and SQLCipher's passphrase KDF does not stretch it. SQL tracing is off. The hex string cannot be wiped; it is not logged and not written to disk.

`ert.sqlite` has no application header. The 320-byte `ERTK` envelope is the whole of the sidecar `ert.keys` (or `<database basename>.keys` when `ERT_DB` is not named `ert.sqlite`), in the same directory. Three slots in that file wrap the same DEK with AES-256-GCM and a 128-bit tag:

| Slot | Who | Key-encryption key |
|---|---|---|
| 0 | Admin 1 | Argon2id(password, per-slot salt) |
| 1 | Admin 2 | Argon2id(password, per-slot salt) |
| 2 | Recovery | HKDF-SHA-256 of a 160-bit paper key |

The in-database `key_slot` table is not the wrap store. The implementation removes it instead of writing wraps into it.

`file_id` in the key file is also stored in encrypted `schema_meta.file_id`. After a slot unwraps, unlock reads that column and rejects the pair when the ids differ. A backup, a `.vN.bak` migration copy, and a USB copy each take the database and the key file together. Either file alone does not open.

Argon2id is the password KDF because those secrets are low-entropy. The recovery key already has 160 bits of entropy, so a memory-hard KDF would not raise the offline cost. HKDF only expands it to a 256-bit AES key. New admin slots store `m = 64 MiB` (65536 KiB), `t = 3`, `p = 1`, Argon2 version `0x13`, and a 16-byte salt. Unlock refuses an Argon2id slot below that minimum, or above the resource ceiling in the spec, before it runs the KDF.

Each wrap uses a fresh random 96-bit GCM nonce, including every rewrap. The database body does not add another nonce scheme. SQLCipher 4 already stores a random 128-bit IV per page write and regenerates it on the next write. HMAC-SHA512 covers the ciphertext, the IV and the page number. [#175](https://github.com/Vihvila92/Easy-Race-Timer/pull/175) pins `legacy = 4`, `hmac_use = 1`, `hmac_algorithm = 2` and `plaintext_header_size = 0`, which is that construction. This decision does not ask for a stricter page mode.

Every stored field in the key file that an attacker could edit to weaken a slot is GCM associated data. That includes the envelope version, the KDF id, the KDF parameters and the salt. Flipping any of those bytes makes unlock fail: the GCM tag fails, and a parameter taken below the minimum is refused before the KDF runs. The app refuses the whole key file if any slot is below the minimum, so a weak wrap of the same DEK is not left on disk while another slot still opens.

Changing an admin password, or replacing an admin, rewraps only that slot: new salt, new nonce, same DEK, same database. The other slots stay byte-for-byte. Replacing an admin leaves both slots with the remaining person until a second admin sets their own password. The UI says that and asks for the second person. This does not protect old copies of the pair. The current database is closed to a former admin by `PRAGMA rekey` to a new DEK, then rewrapping every slot and regenerating the recovery key, then destroying backup pairs this operator still controls. Rekey runs on a copy, with the journal switched from WAL to DELETE for the rekey and back to WAL afterwards. A copy that has already left stays readable. Rotation does not erase a stick the program cannot see.

Wrong passwords and wrong recovery keys share one backoff record, `unlock-backoff.json`, in the directory that holds the database. `ERT_DB` on a USB path therefore shares that directory's counter. The delay increases after 5 failures, is capped at 15 minutes, and is written and `fsync`ed before the KDF so it survives a restart. The record contains no secret. Deleting it, or attacking a copied pair on another machine, clears the online delay. Argon2id and the recovery key's entropy are what limit an offline attacker. The error text does not say which slot failed.

A production or packaged build has no dev key. A file opens only with a DEK unwrapped from a slot. The dev key is available only when `NODE_ENV` is `test` or `development` and `ERT_DEV_KEY=1`. An unset or empty `NODE_ENV` fails closed.

Both admin passwords and the recovery key are required at creation. The recovery key is shown once, with a checksum, and is never stored in either file or in logs. If both passwords and that paper key are lost, the data cannot be recovered. There is no escrow and no cloud KMS.

Login sessions and the swappable auth provider are [#132](https://github.com/Vihvila92/Easy-Race-Timer/issues/132). The v0.1 event PIN is unchanged by this decision.

## Slot format

All multi-byte integers are big-endian. Version 1 of `ert.keys` is exactly these 320 bytes. Nothing follows them. `ert.sqlite` is a separate file and starts with the SQLCipher header.

### Envelope prefix (32 bytes)

| Offset | Size | Field | Version 1 value |
|---:|---:|---|---|
| 0 | 4 | magic | `45 52 54 4B` (`ERTK`) |
| 4 | 2 | `envelope_version` | `1` |
| 6 | 2 | `header_length` | `320` |
| 8 | 16 | `file_id` | CSPRNG, not secret. The same value is stored in `schema_meta.file_id`. It stays the same across DEK rotation |
| 24 | 1 | `slot_count` | `3` |
| 25 | 1 | `flags` | `0` |
| 26 | 6 | reserved | `0` |

### Slot record (96 bytes)

Slot 0 is at offset 32, slot 1 at 128, slot 2 at 224.

| Offset | Size | Field | Admin slot | Recovery slot |
|---:|---:|---|---|---|
| 0 | 1 | `slot_index` | `0` or `1` | `2` |
| 1 | 1 | `slot_type` | `1` admin | `2` recovery |
| 2 | 1 | `kdf_id` | `1` Argon2id | `2` HKDF-SHA-256 |
| 3 | 1 | `argon_version` | `0x13` | `0x00` |
| 4 | 4 | `memory_kib` | `65536` (64 MiB) | `0` |
| 8 | 4 | `iterations` | `3` | `0` |
| 12 | 4 | `parallelism` | `1` | `0` |
| 16 | 1 | `salt_len` | `16` | `16` |
| 17 | 1 | `nonce_len` | `12` | `12` |
| 18 | 1 | `tag_len` | `16` | `16` |
| 19 | 1 | reserved | `0` | `0` |
| 20 | 16 | salt | CSPRNG | CSPRNG |
| 36 | 12 | nonce | CSPRNG, new on every wrap and rewrap | same |
| 48 | 32 | ciphertext | AES-256-GCM wrap of the 32-byte DEK | same |
| 80 | 16 | tag | GCM tag | GCM tag |

### Associated data

For each slot, AES-256-GCM associated data is the 32-byte envelope prefix concatenated with the first 48 bytes of that slot record (index through nonce). The ciphertext and the tag are GCM outputs and are not part of the associated data. The nonce is both the GCM nonce and part of the associated data.

Those 80 bytes cover the format version, the file id, the slot count, the KDF id, the Argon2 version, `memory_kib`, `iterations`, `parallelism`, the salt length, the nonce length, the tag length, the salt and the nonce. Tampering with any of them makes `unlock` fail the tag. The minimum-parameter check runs first, so a downgraded `memory_kib` or `iterations` is refused before Argon2id runs.

The plaintext inside the wrap is exactly the 32-byte DEK. Tags are 128 bits and are not truncated.

## Threat model

Assets are the personal data and race records inside `ert.sqlite`, the DEK, the two admin passwords, and the recovery key.

The attacker this section is written for has the USB stick (`ert.sqlite`, `ert.keys`, the `backups/` pairs, the `.vN.bak` pairs, and `unlock-backoff.json`) and their own computer. They do not know either password or the recovery key. They can edit or delete files on the stick.

### What that attacker can do

- Copy the pair and guess offline. The backoff file does not apply on a machine that ignores it, and deleting `unlock-backoff.json` resets the delay on the club laptop. Offline password guesses pay the full Argon2id cost (`m = 64 MiB`, `t = 3`, `p = 1`) for each guess on each admin slot.
- Read `ert.keys`: magic, version, file id, salts, nonces, KDF parameters, ciphertext and tags. Those fields are not secret. The key file is authenticated, not encrypted. `ert.sqlite` without `ert.keys` does not unwrap.
- See that the key file is an Easy Race Timer envelope. Hiding that fact is not a goal.
- Flip key-file bits. The app then fails closed: either `KEY_PARAMS_REJECTED` when a parameter is below the minimum or above the ceiling, or `UNLOCK_FAILED` when the tag does not verify. Availability of that copy is lost. Confidentiality is not.
- Restore an older backup pair they also hold. That pair still opens with the passwords and recovery key that were current when the backup was made. Replacing one admin, or rewrapping one slot, does not change this.
- Splice an old admin slot back into a key file whose DEK was not rotated. The old slot still unwraps the same DEK, and `file_id` still matches. Opening the current database is then possible with the old password. Splicing an old slot into a key file whose DEK was rotated yields the old DEK, which does not open the new database.

### What that attacker cannot do

- Read names, birth years, contact details, consents, results, the audit log or in-file accounts from `ert.sqlite`.
- Unwrap the DEK without a current admin password or the current recovery key, or without the matching key file.
- Change the format version, KDF id, KDF parameters, salt, nonce or slot type and still have the GCM tag verify.
- Persuade this app to run Argon2id below `m = 64 MiB`, `t = 3`, `p = 1`. A key file with any slot below the minimum is refused as a whole, so a weak extra wrap cannot sit beside a strong one.
- Learn from the app's error which admin slot was tried, whether an account exists, or whether the password was close. The locked screen has one password field and always runs both admin KDFs.
- Guess the recovery key in practice. It has 160 bits of entropy. The checksum is a typo check over a public format, not a shortcut to the key.
- Open a database with a key file whose `file_id` does not match `schema_meta.file_id`.
- Recover the data if both admin passwords and the recovery key are lost, or if the key file is lost. Nobody, including the authors of this program, has a spare key.
- Use the dev key against a production or packaged build, or when `NODE_ENV` is unset.

### Other actors

- A person who has the printed recovery key and the key file can open the current database. The app then requires a new admin password before normal use. They can also open any backup pair made while that same recovery slot was current.
- An admin who still knows a current password can open the current pair, replace the other admin's slot, and regenerate the recovery key. Old pairs keep the old wraps until the DEK is rotated and those pairs are destroyed.
- A former admin who may still hold a copy is not locked out by a slot overwrite. The required procedure is `PRAGMA rekey` plus destruction of backup pairs this operator still controls. Copies already in the former admin's hands stay readable. This program cannot erase a stick it does not have.
- A debugger on an unlocked process, or malware running as the club user, can read the DEK while the file is open. That is a compromised device and is out of scope for this control. Zeroizing buffers and redacting logs limit leftovers. They do not stop the debugger. Swap and hibernation can retain key bytes; `mlock` is best-effort and is not claimed as a guarantee.
- The online backoff slows guessing through this app's unlock screen and still applies after a process or OS restart. It is not a lock that the USB-stick attacker has to break.

## Consequences

- The implementation of [#131](https://github.com/Vihvila92/Easy-Race-Timer/issues/131) follows [the spec](../spec/key-management.md) and does not start before Santtu's approval comment.
- [#175](https://github.com/Vihvila92/Easy-Race-Timer/pull/175) keeps the SQLCipher page format, including the random per-page IV and HMAC-SHA512. Its backup and `.vN.bak` paths gain a copy of the key file in the same operation. This ADR does not change that code.
- `key_slot` inside the database is dropped rather than used for wraps.
- A password change rewrites only `ert.keys`. Cutting off a person who may have a copy is `PRAGMA rekey` on a copy, a new key file, and a manual cleanup of backup pairs. The UI has to say that in plain language.
- `unlock-backoff.json` is a 0600 file in the database directory. It is not inside the encrypted body, because the count has to be updated before the DEK is known.
- Locale files, the print stylesheet and the tests listed in the spec are part of the implementation. This ADR adds no code.

## Alternatives considered

- A 320-byte `ERTK` prefix in front of `ert.sqlite`. SQLCipher would no longer see page 1 at offset 0, and SQLite3 Multiple Ciphers would need a custom VFS. Rejected.
- Storing the wraps in `key_slot` inside the encrypted database. The table cannot be read before the DEK is known. Rejected.
- One shared password and no paper key. The club cannot open the file if that one person is away, and there is no recovery path. Rejected.
- Argon2id on the recovery key as well. It does not move a 160-bit search, and it makes honest recovery slow. Rejected for the recovery slot only.
- A cloud KMS or a vendor escrow key. Out of scope, and it contradicts the rule that a lost paper key means the data is gone.
- Rekeying the live WAL database in place. SQLite3 Multiple Ciphers does not support rekey in WAL mode, and a crash would leave the only copy half-rekeyed. Rejected in favor of rekey on a copy, journal `DELETE` during the rekey, then WAL again, then an atomic rename of both files.
- An OS keychain as the only place the DEK lives. The pair on a backup stick would then be unopenable on another computer, which is the club's recovery path. A keychain may be added later. It does not replace `ert.keys`.
