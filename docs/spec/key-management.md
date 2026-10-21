# Key handling for the encrypted race file

- Status: proposed for Santtu's review. This is the key-handling spec requested on [#131](https://github.com/Vihvila92/Easy-Race-Timer/issues/131#issuecomment-6308842611). Implementation starts only after Santtu approves it in a comment on that issue. This document is not that approval.
- Date: 2026-10-21
- Decision and byte layout: [ADR 0012](../adr/0012-key-management.md)
- Depends on [#130](https://github.com/Vihvila92/Easy-Race-Timer/issues/130) (one SQLCipher file, one 256-bit DEK). Sessions are [#132](https://github.com/Vihvila92/Easy-Race-Timer/issues/132) and are out of scope here.

The ADR and this spec match. The ADR owns the slot layout and the USB-stick threat model. This spec owns parameters, procedures, user-facing text and the tests. Update both in the same change.

No secret values appear in this document. Examples of the recovery key use the placeholders `XXXX` and `CCCC` only.

## Review checklist

Santtu's review asked for each item below. The linked section is the normative text.

| # | Required statement | Section |
|---|---|---|
| 1 | A fresh random 96-bit GCM nonce on every wrap and every rewrap, plus a unique nonce scheme for encryption under the DEK. Nonces are never reused with the same key. | [Nonces](#nonces) |
| 2 | The slot header (format version, KDF parameters, salt) is GCM associated data. Tampering with any of those fields makes unlock fail. The rest of the file header is authenticated the same way. | [Header authentication](#header-authentication) |
| 3 | Argon2id minimum `m >= 64 MiB`, `t >= 3`, `p = 1`. Unlock refuses anything weaker before the KDF runs. Salt is 16 bytes from a CSPRNG. | [KDF and downgrade refusal](#kdf-and-downgrade-refusal) |
| 4 | Recovery key has at least 128 bits of entropy, an unambiguous Crockford Base32 form, a checksum, is shown once, and is never stored in the file or in logs. | [Recovery key](#recovery-key) |
| 5 | Failed unlocks hit an increasing backoff that survives a restart. The error does not reveal which slot failed. | [Unlock failures and persistent backoff](#unlock-failures-and-persistent-backoff) |
| 6 | DEK, KEKs, passwords and the recovery key live in `Buffer`s and are zeroized after use where Node allows it. They are not turned into JS strings except at the input boundary. The unwrapped DEK is never written to disk. A test scans the data directory. | [Zeroization and the on-disk DEK scan](#zeroization-and-the-on-disk-dek-scan) |
| 7 | Resetting another admin requires an authenticated admin and rewraps only that slot. Replacing an admin overwrites that slot. This does not protect old copies. If a former admin may still hold a copy, rotate the DEK, re-encrypt, and rewrap every slot. | [Admin change and DEK rotation](#admin-change-and-dek-rotation) |
| 8 | Regenerating the recovery key requires an unlocked admin session and invalidates the old slot. If both passwords and the recovery key are lost, the data cannot be recovered. The UI and the recovery guide say that in plain language. | [Recovery key loss](#recovery-key-loss) and [Recovery key guide](#recovery-key-guide) |
| 9 | Passwords are at least 10 characters, are checked against a common-password list, and the maximum is not below 64 characters. | [Passwords](#passwords) |
| 10 | Slot format and the USB-stick threat model are in the ADR. | [ADR 0012](../adr/0012-key-management.md) |

The original acceptance criteria on [#131](https://github.com/Vihvila92/Easy-Race-Timer/issues/131) are covered by those sections and by [Tests](#tests). Locale JSON is not edited in the documentation change that introduces this spec. The strings in [User-facing strings](#user-facing-strings) are the contract for the implementation pull request.

## Scope

In scope:

- Envelope header in front of the SQLCipher body from [#130](https://github.com/Vihvila92/Easy-Race-Timer/issues/130).
- Two admin slots and one recovery slot, each an independent AES-256-GCM wrap of the one DEK.
- Password policy, recovery-key format, print text, backoff, zeroization, log redaction, and DEK rotation.

Out of scope:

- Login, sessions, and `AuthProvider` ([#132](https://github.com/Vihvila92/Easy-Race-Timer/issues/132)).
- Cloud KMS, vendor escrow, and an OS keychain as the only key store.
- Encrypting `.ertx` or CSV exports ([#84](https://github.com/Vihvila92/Easy-Race-Timer/issues/84)).
- The v0.1 event PIN (`pin_hash`, `PIN_REQUIRED`). It stays as it is until a later issue changes it. File unlock and the event PIN are different secrets.
- Choosing the SQLCipher package and the migration/backup mechanics. Those stay in [#130](https://github.com/Vihvila92/Easy-Race-Timer/issues/130), subject to the body nonce rule here.

The on-disk race file keeps the path [#130](https://github.com/Vihvila92/Easy-Race-Timer/issues/130) already uses (`ERT_DB`, otherwise `ert.sqlite` in the data directory). Its first bytes are `ERTK`, then the SQLCipher body at offset 320. A tool that expects a raw SQLCipher file has to skip the envelope. `openDataFile(path, dek: Buffer)` receives the unwrapped DEK only after a slot verifies and only in memory.

## File layout

The version 1 header is exactly 320 bytes, as specified in [ADR 0012](../adr/0012-key-management.md#slot-format). The body starts at offset 320. The parser rejects a header whose length, slot count, slot order, types, or reserved bytes differ from that ADR. There is no empty slot and no fourth slot in version 1.

Creation writes all three slots before the file is opened for normal use. The operator sees the recovery key and sets both admin passwords in that same setup. Cancelling setup deletes the partial file and zeroizes every buffer.

Writes of the envelope (create, rewrap, recovery regeneration, DEK rotation) use a temporary file in the same directory, `fsync`, atomic rename, and a directory `fsync` where the operating system supports it. Mode is `0600` on macOS and Linux, and the current-user-only ACL on Windows, including `unlock-backoff.json` and backups. That is the same permission rule as [#130](https://github.com/Vihvila92/Easy-Race-Timer/issues/130).

## Nonces

### Key wraps

Every wrap and every rewrap generates a new 96-bit nonce with `crypto.randomBytes(12)` or `randombytes_buf`. The nonce is stored in that slot (offset 36, length 12). AES-256-GCM uses it as the GCM nonce. The implementation draws again if the new nonce equals any nonce already stored in the three slots. A collision across independent draws is not expected; the compare is there so a stuck RNG cannot persist a reuse.

Rules:

- A rewrap generates a new nonce even when the new password bytes equal the old password bytes. It also generates a new salt. The previous ciphertext is not reused.
- A nonce is never reused with the same key-encryption key. Because the salt also changes, the Argon2id KEK changes on every admin rewrap. The implementation still treats "fresh nonce every time" as the rule, so a future KEK cache cannot silently reuse a nonce.
- The recovery slot follows the same nonce rule on creation and on regeneration.
- The three wrap nonces in a file are distinct from each other.
- GCM nonces are 12 bytes. An 8-byte or 16-byte nonce is a hard failure (`FILE_HEADER_INVALID`) and does not reach the KDF.
- The DEK is not the key for these wraps. The wrap key is the slot KEK. Reuse of a wrap nonce under a different KEK is still forbidden inside one file by the distinct-nonce rule above.

### Body encryption under the DEK

The DEK encrypts the SQLCipher body and nothing else. Key wrapping does not encrypt under the DEK.

Each page or chunk write under that DEK uses a 96-bit nonce that is unique for the life of that DEK. The nonce is generated at write time with the same CSPRNG, stored in the clear beside that page's ciphertext, and fed to an authenticated cipher (AES-256-GCM, or the authenticated mode [#130](https://github.com/Vihvila92/Easy-Race-Timer/issues/130) pins if its nonce is also 96 bits and is stored per write). The page tag covers the nonce.

A nonce derived only from the page number is forbidden. Rewriting the page would reuse it with the same DEK. SQLCipher 4's default AES-256-CBC IV is a function of the page number and does not meet this requirement. The [#130](https://github.com/Vihvila92/Easy-Race-Timer/issues/130) implementation selects a stricter mode (per-write nonce in the SQLCipher reserve, or 64 KiB chunks in the envelope body) and records the mode in the storage ADR. This spec's uniqueness test is the acceptance check either way.

An allowed alternative, if the storage ADR records it, is a 96-bit nonce split as a random per-DEK prefix plus a counter stored with the ciphertext. The counter is authenticated by the page tag, never repeats for that DEK, and forces a DEK rotation instead of wrapping. The default to implement is the random 96-bit nonce per write.

Random 96-bit nonces also cover the backup-rollback case: an attacker who kept a newer snapshot and then forced the app onto an older snapshot does not cause a repeat, short of a birthday collision. A file that encrypts fewer than 2^32 pages stays far from that bound. The app does not use one nonce for the whole file.

DEK rotation generates a new DEK and new body nonces. The old DEK is not used again. Page numbers may coincide between the old file and the new file; the key is different, so that is not nonce reuse.

The DEK is handed to SQLCipher as a raw 256-bit key via the binding's Buffer key method (`openDataFile`). It is not interpolated into `PRAGMA key` text, and SQLCipher's own passphrase KDF is not run on top of it. Production builds do not enable SQL tracing.

## Header authentication

AES-256-GCM associated data for a slot is the 80-byte string defined in [ADR 0012](../adr/0012-key-management.md#associated-data): the 32-byte envelope prefix, then the first 48 bytes of that slot (through the nonce).

Those bytes include every field Santtu named:

- format version (`envelope_version`, and the Argon2 version byte)
- KDF parameters (`kdf_id`, `memory_kib`, `iterations`, `parallelism`, salt length, nonce length, tag length)
- salt

They also include the magic, header length, file id, slot count, flags, reserved bytes, slot index and slot type. File header integrity is this associated data: every slot tag covers the shared envelope prefix, and each slot tag covers that slot's own header fields.

Tampering with any of those fields makes unlock fail. When the edited parameters still pass the minimum and the ceiling, the failure is the GCM tag (`UNLOCK_FAILED`) and the GCM output is zeroized. When the edit puts a parameter below the minimum or above the ceiling, the failure is `KEY_PARAMS_REJECTED` before the KDF, which is the downgrade rule. Either way the body does not open.

The ciphertext and the tag are not associated data. They are the GCM output. A bit flip there also fails verification.

The app does not treat a GCM-valid DEK as a successful unlock until SQLCipher has opened the body with that DEK and an integrity check (`cipher_integrity_check`, or `PRAGMA integrity_check` if that is what the pinned cipher exposes) has passed. A spliced slot that unwraps an old DEK fails that check against the current body. The DEK is zeroized and the result is `UNLOCK_FAILED`.

Header policy failures that happen before GCM use `KEY_PARAMS_REJECTED` or `FILE_HEADER_INVALID`, as specified in [KDF and downgrade refusal](#kdf-and-downgrade-refusal). Those codes still do not name a slot.

## KDF and downgrade refusal

### Admin slots

New admin slots use Argon2id only, with these exact stored values:

| Parameter | Stored value | Passed to Argon2id |
|---|---|---|
| Variant | `kdf_id = 1` | Argon2id, never Argon2i or Argon2d |
| Version | `0x13` | Argon2 version 1.3 |
| Memory | `memory_kib = 65536` | 65536 KiB, which is 64 MiB. The API unit is KiB. |
| Iterations | `3` | `t = 3` |
| Parallelism | `1` | `p = 1` |
| Salt | 16 CSPRNG bytes | the slot salt |
| Output | 32 bytes | the KEK |

Argon2 associated data (this is not the GCM associated data) is the ASCII string `ert-admin-kek-v1`, then `slot_index` as one byte, then `slot_type` as one byte. There is no pepper.

The password bytes are the UTF-8 encoding of the NFKC form of the password the operator typed. The length rules are in [Passwords](#passwords). Case is preserved for the KDF. The common-password check case-folds; the KDF does not.

This minimum is the one [#131](https://github.com/Vihvila92/Easy-Race-Timer/issues/131) set. It stays at least this high even if a later OWASP note publishes a lower memory figure. Lowering it is a spec change Santtu has to accept.

### What unlock accepts

Before any KDF, the parser checks every slot.

An admin slot is accepted only when all of the following hold:

- `kdf_id` is Argon2id (`1`)
- `argon_version` is `0x13`
- `memory_kib` is from 65536 through 262144 (64 MiB through 256 MiB)
- `iterations` is from 3 through 16
- `parallelism` is from 1 through 4
- `salt_len` is 16, `nonce_len` is 12, `tag_len` is 16

`p = 1` is the value new files write. `p < 1` is below the minimum and is refused. `p` from 2 through 4 is not a downgrade; it is accepted so a later file that raised parallelism still opens. `p > 4`, `memory_kib` above 256 MiB, or `iterations` above 16 is refused without allocating that much memory. The ceiling is a local resource limit. Phase 1 writes only 65536 / 3 / 1.

The KDF call uses the parameters stored in the slot, after those checks. A file legitimately written with `memory_kib = 131072` (128 MiB) is derived with 128 MiB, not silently with 64 MiB.

A recovery slot is accepted only when `kdf_id` is HKDF-SHA-256 (`2`), the Argon2 fields and `argon_version` are 0, and the salt, nonce and tag lengths are 16, 12 and 16. Recovery does not use Argon2id. See [Recovery key](#recovery-key).

If any slot fails these checks, the whole file is refused with `KEY_PARAMS_REJECTED`. The app does not open the other slots and does not run Argon2id. A weak wrap of the same DEK must not remain usable beside a strong slot. The password form is not shown for that file.

Unknown `envelope_version`, bad magic, a wrong header length, a non-zero reserved byte, or a nonce length other than 12 is `FILE_HEADER_INVALID`, also before the KDF.

### Salts

Each slot has its own 16-byte salt from `crypto.randomBytes(16)` or `randombytes_buf`. Version 1 does not allow a longer salt; a longer salt is a new envelope version. Sixteen bytes meets the minimum of 16 bytes. The salt is stored in the slot and is covered by GCM associated data. Salts are not secret. They are not reused across slots or across rewraps.

## Recovery key

### Entropy and encoding

The recovery secret is 20 bytes from the CSPRNG. That is 160 bits, which is above the 128-bit minimum. The implementation refuses to persist a recovery slot whose secret is shorter than 16 bytes. Version 1 always uses 20 bytes.

Encoding is Crockford Base32, uppercase, most-significant bit first. The alphabet is `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (no I, L, O or U). Twenty bytes is 32 characters, with no padding. The display groups them in fours:

`XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-CCCC`

The last group `CCCC` is a 20-bit checksum, not key material:

1. `digest = SHA-256(ASCII("ert-recovery-checksum-v1") || raw 20 bytes)`.
2. The checksum is the first 20 bits of `digest`: `digest[0]`, `digest[1]`, and the high 4 bits of `digest[2]`.
3. Those 20 bits are Crockford-encoded as four characters, most-significant bit first.

On input the app strips ASCII spaces, hyphens and newlines, uppercases ASCII, and applies Crockford aliases: `O` to `0`, `I` and `L` to `1`, `U` to `V`. Any other character outside the alphabet, or a length other than 36 characters, is a checksum failure. The 32 key characters are decoded to 20 bytes. The four checksum characters are compared to the recomputed checksum with `crypto.timingSafeEqual`. A mismatch is `RECOVERY_KEY_CHECKSUM`.

That check runs before HKDF and before GCM. A typo does not burn an Argon2id-sized computation and does not look like a wrong password inside the cryptographic path. It does count toward the backoff in [Unlock failures and persistent backoff](#unlock-failures-and-persistent-backoff), so a script cannot skip the delay by sending malformed keys.

The checksum is a typing aid. It is not a MAC on the file and it does not reduce the search space of an offline attacker who ignores it. Guessing a checksum-valid key still costs 160 bits.

### KEK

The recovery KEK is HKDF-SHA-256 (RFC 5869):

| Input | Value |
|---|---|
| IKM | the raw 20 bytes, not the printed text and not the checksum |
| salt | the 16-byte slot salt |
| info | ASCII `ert-recovery-kek-v1`, then `slot_index`, then `slot_type` |
| L | 32 |

The printed form and the checksum characters are never the HKDF input. Argon2id is the wrong tool here: it does not make a 160-bit secret harder to guess, and it would slow honest recovery. Admin passwords stay on Argon2id because they are short.

The wrap itself is the same AES-256-GCM construction as an admin slot, with its own salt and its own nonce.

### Shown once, never stored

The raw secret and the printed groups exist only in `Buffer`s on the setup or regeneration screen. The screen offers a print action (`window.print` of that view). The app does not write a PDF, a text file, a screenshot or a second copy into the data directory.

Leaving the screen, finishing setup, or regenerating again zeroizes those buffers. There is no "show the key again" control. The only persisted form is the wrap: salt, nonce, ciphertext, tag and the KDF id. The file, the backups, `unlock-backoff.json` and the logs do not contain the raw bytes, the Crockford text, or a hex or base64 form of the secret.

Setup is not complete until both admin passwords are set and the operator has been shown the key. A confirmation control ("I have printed or written this key") is a speed bump, not proof. Dismissing the screen zeroizes the key either way. The loss warning in [Recovery key guide](#recovery-key-guide) is on that screen and on the printed page.

## Unlock failures and persistent backoff

### One password field

The locked screen has a single password field. It does not list admins, and it does not ask which admin is typing. Either admin types their own password. The app always runs Argon2id for slot 0 and for slot 1, with the stored parameters, even when slot 0 already verified. It does not return on the first match. Both GCM checks run. A match opens the file. Zero matches is `UNLOCK_FAILED`. The response never includes a slot index.

The recovery action is a separate control the operator chooses. That path checks only the recovery slot. Choosing it does not by itself say whether a password would have worked.

`UNLOCK_FAILED` is the same code and the same message for a wrong admin password, a checksum-valid wrong recovery key, a GCM failure, and a DEK that does not open the body. The message does not say which slot failed, whether an admin exists, or whether the secret was close.

While a backoff wait is in force, the code is still `UNLOCK_FAILED` and the message is the wait sentence in [User-facing strings](#user-facing-strings). The client may receive `retryAfterMs` so it can disable the button. It does not receive `failureCount`.

`RECOVERY_KEY_CHECKSUM` is the one more specific code, and only for a recovery key that fails the checksum or the alphabet. That is the typo path [#131](https://github.com/Vihvila92/Easy-Race-Timer/issues/131) requires before unlock is attempted.

### Delay schedule

Password failures and recovery failures, including checksum failures, share one counter. Switching from the password form to the recovery form does not reset it.

`n` is the number of failures already recorded when the operator tries again. The first five attempts have no extra wait. The attempt after the fifth failure waits 1 second, and each further failure doubles that wait.

| Prior failures | Wait before the next attempt |
|---:|---|
| 0–4 | 0. The only delay is the work itself (Argon2id for a password). |
| 5 | 1 s |
| 6 | 2 s |
| 7 | 4 s |
| 8 | 8 s |
| 9 | 16 s |
| 10 | 32 s |
| 11 | 64 s |
| 12 | 128 s |
| 13 | 256 s |
| 14 | 512 s |
| 15 and above | 900 s (15 minutes) |

`delaySeconds(n) = n < 5 ? 0 : min(900, 2^(n - 5))`.

### Persistence across restarts

The record is `{data directory}/unlock-backoff.json` next to the race file (the directory of `ERT_DB`). It is not inside the encrypted body, because it has to be updated before the DEK is known. Mode `0600`. JSON only:

```json
{
  "version": 1,
  "failureCount": 0,
  "lastAttemptMs": 0
}
```

No password, no key, no salt, no slot id, no file path. `failureCount` and `lastAttemptMs` are not secret, but they are still not logs of the secret.

The file is rewritten by the same temp-file, `fsync`, rename sequence as the envelope. An exclusive lock covers the read-modify-write so two unlock requests cannot both pass the wait check.

Procedure for one attempt:

1. Take the lock and read the record. A missing file means `failureCount = 0` and `lastAttemptMs = 0`, and the app creates it.
2. `delayMs = delaySeconds(failureCount) * 1000`. If `failureCount` is 0, the wait is 0. If `lastAttemptMs` is 0 or is in the future, the wait is the full `delayMs`, so a cleared timestamp or a clock moved backward does not skip the delay. Otherwise the wait is `max(0, lastAttemptMs + delayMs - now)`.
3. If the wait is greater than 0, release the lock and return `UNLOCK_FAILED` with `retryAfterMs`. Do not run a KDF. Do not increment again.
4. Otherwise set `failureCount` to `failureCount + 1` and `lastAttemptMs` to now, `fsync` the record, and release the lock. A crash during the later KDF still leaves the increment on disk.
5. Run the checksum check or the KDF and GCM.
6. On success, after the body integrity check passes, set `failureCount` and `lastAttemptMs` back to 0, `fsync`, and only then tell the UI the file is open.
7. On failure, leave the incremented record as step 4 wrote it.

Replacing the race file does not reset the counter. The counter belongs to the data directory, not to `file_id`. A restart of the process or of the operating system reads the same file and continues the wait.

This backoff does not bind an attacker who copies the race file onto another computer, or who deletes `unlock-backoff.json`. Those limits are in the [ADR threat model](../adr/0012-key-management.md#threat-model). The recovery key is protected offline by its entropy, not by this delay. Admin passwords are protected offline by Argon2id.

## Zeroization and the on-disk DEK scan

DEK, admin KEKs, the recovery KEK, password bytes and recovery-key bytes are `Buffer`s (or libsodium secure memory when that binding is what the implementation uses). After the last use of a buffer, the code calls `buffer.fill(0)` in a `finally` block, or `sodium_memzero` when the bytes live in a libsodium allocation. Failed GCM output is cleared the same way.

The DEK buffer that SQLCipher needs stays alive until the database is closed or the file is locked. Closing the database is what clears that copy. Zeroizing it earlier would be a use-after-free of the key. On close, the storage module zeroizes its DEK buffer. A rewrap zeroizes the slot KEK before it returns. Setup and the regeneration screen zeroize the recovery secret when the screen closes.

JavaScript strings cannot be wiped. The only place a password or a recovery key may be a string is the input boundary: the field the operator typed. The handler copies UTF-8 into a `Buffer` immediately and does not put that string on an object the logger serializes, in an `Error`, in a template string, or in a SQL statement. The redaction list below is the backstop for the request object.

`mlock` / `sodium_mlock` is used when the process can take it. Failure to lock memory is not an unlock failure. The threat model does not claim the key is absent from swap.

### Disk scan

The unwrapped DEK is never written to the race file, a temporary file, a journal, a WAL, a backup, `unlock-backoff.json`, or a log. Tests that create a file, rewrap a slot, regenerate a recovery key, and rotate the DEK then scan the data directory for:

- the raw 32 DEK bytes
- lowercase hex and uppercase hex
- base64 and base64url

The scan includes every file in the directory, including backups and temps. None of those encodings may appear. The same tests use a canary password and a canary recovery secret and assert that neither appears in the directory or in captured logs. Canaries are test fixtures, generated in the test, not constants committed as sample keys.

### Logs and crash reports

Pino (and any crash-report serializer that uses the same logger) redacts these paths, including nested copies: `password`, `newPassword`, `currentPassword`, `recoveryKey`, `recovery_key`, `dek`, `dataKey`, `data_key`, `kek`, `key`, `pin`, `authorization`, `cookie`, `token`.

An info log during unlock is one of `unlock ok`, `unlock failed`, `unlock backoff`. It may include the numeric `failureCount`. It does not include a slot index, a salt, a nonce, a ciphertext, or any secret. The encrypted audit log inside the file may record which slot opened, after unlock. The plaintext log does not.

A test throws during unwrap and asserts that the error message, the serialized error, and the captured log do not contain the canary password, the canary recovery text, or the DEK encodings above.

## Admin change and DEK rotation

An authenticated admin is an admin slot that verified in this process lifetime and whose session has not locked. A recovery-key unlock is not an admin session until a new admin password has been set. See [Recovery opens the file](#recovery-opens-the-file). The actor for a reset is that authenticated admin. [#132](https://github.com/Vihvila92/Easy-Race-Timer/issues/132) may later name the session; this spec's requirement is that the file was opened by a valid admin password in this process, not by a flag left on disk.

### Rewrap only

Changing one admin password, or resetting the other admin's password, rewraps that one slot:

1. The acting admin is authenticated. Resetting the other slot does not require the other admin's current password. Changing one's own password also requires the current password, so a person who finds an unlocked laptop cannot rotate it silently.
2. The new password is checked with [Passwords](#passwords) and entered twice.
3. The two admin passwords must differ. The compare uses the password buffers and then zeroizes the temporary copies.
4. New 16-byte salt, new 96-bit nonce, Argon2id at the current baseline (65536 KiB, `t = 3`, `p = 1`), AES-256-GCM wrap of the **same** DEK.
5. The other slot's 96 bytes are unchanged. The SQLCipher body is unchanged. `file_id` is unchanged.

A test hashes the body before and after and compares the other slot's raw bytes. Both are equal. The changed slot's nonce and ciphertext differ from the previous bytes.

Removing an admin is the same overwrite. Version 1 has no empty slot. The remaining person sets a new password on that slot (still different from their own). The previous password no longer unwraps the current file.

### Old copies

A slot overwrite does **not** protect old copies of the file. A backup, a pre-migration `.bak`, a USB copy, or an email attachment made before the rewrap still opens with the old password and the old recovery key. Someone who can write the current file and who has the old slot bytes can also splice that slot back, because the DEK did not change. The [threat model](../adr/0012-key-management.md#threat-model) states that splice.

The UI says this in the password-change confirmation, in English and in Finnish, using `keys.oldCopies` in [User-facing strings](#user-facing-strings).

### When a former admin may still hold a copy

If a former admin may still have a copy, the operator rotates the DEK. Password rewrap is the wrong tool for that case. Rotation:

1. An authenticated admin unlocks the current file.
2. Generate a new 32-byte DEK from the CSPRNG.
3. Write a new envelope in a temporary file. Re-encrypt every page under the new DEK with new body nonces. `file_id` stays the same so the backoff record remains in force.
4. Rewrap both admin slots under the current passwords (or under passwords the operator sets during the rotation) and regenerate the recovery key. The new recovery key is shown once. The old paper key does not unwrap the new file.
5. `fsync`, rename the temp file over the race file, `fsync` the directory. Zeroize the old DEK and the new recovery secret after the print screen closes.
6. Delete or re-encrypt backups this operator still controls. The app lists the `backups/` directory and the `.bak` files it knows about and asks the operator to confirm deletion. It does not claim to see USB sticks that are not mounted.
7. Tell the operator, in the same screen, that a copy already in someone else's hands is still readable, and that this program cannot erase it.

After rotation, the old admin password fails on the new file if that slot was given a new password; the old recovery key fails either way because regeneration is mandatory; a pre-rotation backup still opens with the old secrets. The tests assert all three. That last result is deliberate: it is why step 6 exists.

Rotation is unavailable during the recovery-key gate below. The operator sets an admin password first, then rotates if they need to.

## Recovery opens the file

A checksum-valid recovery key that unwraps the DEK and opens the body unlocks the data and enters a gate session. The gate is not an admin session. The only way forward is to set a new password on at least one admin slot (the rewrap rules above, without asking for the forgotten password). The UI does not offer the rest of the app until that rewrap is on disk. The other admin slot is left as it was, so a second admin who still knows their password is not locked out. If both passwords were forgotten, the operator sets both before leaving the gate. The spec requires one new admin password as the minimum; the screen asks whether the other password is also lost and, if so, requires the second one too.

The recovery slot is unchanged by this gate. The screen warns the operator to regenerate the recovery key if anyone else may have seen the paper. Regeneration itself waits until the new admin password is in place, because regeneration requires an admin session.

## Recovery key loss

Regenerating the recovery key:

1. Requires an unlocked admin session (password unlock, or a recovery gate that has already finished the new admin password).
2. Draws a new 20-byte secret, a new salt and a new nonce, and wraps the current DEK.
3. Overwrites slot 2 in one atomic envelope write. The admin slots and the body stay as they are unless this regeneration is part of a DEK rotation.
4. Shows the new key once, with the guide warning.
5. Leaves the previous recovery wrap only in older copies of the file. The current file rejects the old paper key.

If both admin passwords and the recovery key are lost, the data cannot be recovered. There is no reset, no support backdoor, and no copy of the key held by the authors of the program. The names, results and consents in that file are gone. The operator is told that, in those words, on the setup screen, on the printed page, and in the guide below. The Finnish text is the same statement, not a shorter paraphrase.

Regenerating or rotating does not destroy old copies. The guide says that too.

## Recovery key guide

This is the plain-language guide. The implementation shows it from setup, from the print view, and from the regeneration screen, in the language the operator has selected. The loss paragraph is always on the printed page.

### English

**How to print it.** When the program shows the recovery key, print that page or copy the groups onto paper by hand. Check the last group (the checksum) twice. The program shows the key only this once. After you leave the page, it deletes the key from memory and cannot show it again.

**Where to store it.** Keep the paper away from the laptop, the way you keep a spare house key. A labelled envelope with a named officer of the club is enough. Two copies in two buildings are better than one copy in the laptop bag. Do not put the key in email, chat, a photo roll, or a file on the race laptop. Anyone who has the paper can open the race file.

**How to use it.** On the locked screen, choose "I don't have the passwords" and type the groups, including the last group. You can type the letters O, I and L; the program reads them as 0 and 1. If a group is mistyped, the program says so and does not try to open the file. If the key is accepted, the program then asks for a new admin password and will not continue until that password is set.

**If the key is lost or seen by someone else.** If you still know an admin password, open the file and create a new recovery key. The paper you have now stops working for this file. An old copy of the file, such as a USB backup taken before that change, still opens with the old paper. Destroy those copies, or rotate the data key if a former admin might still have one.

**If both passwords and the paper are lost.** If both admin passwords and this recovery key are lost, the race file cannot be opened. There is no way to reset it and no one else has a copy of the key. The names, results and consents in the file would be gone.

### Suomi

**Tulostus.** Kun ohjelma näyttää palautusavaimen, tulosta sivu tai kirjoita ryhmät paperille käsin. Tarkista viimeinen ryhmä (tarkistussumma) kahdesti. Ohjelma näyttää avaimen vain tämän kerran. Kun poistut sivulta, ohjelma hävittää avaimen muistista eikä voi näyttää sitä uudelleen.

**Säilytys.** Säilytä paperi eri paikassa kuin kannettava, kuten vara-avain. Seuran nimetyn toimihenkilön kirjekuori riittää. Kaksi kopiota kahdessa rakennuksessa on varmempi kuin yksi kopio kannettavan laukussa. Älä lähetä avainta sähköpostilla tai viestillä, älä kuvaa sitä puhelimeen äläkä tallenna sitä kisakoneen tiedostoksi. Jokainen, jolla on paperi, voi avata kisa-tiedoston.

**Käyttö.** Lukitulla näytöllä valitse "Minulla ei ole salasanoja" ja kirjoita ryhmät, myös viimeinen. Kirjaimet O, I ja L kelpaavat: ohjelma lukee ne nollana ja ykkösenä. Jos ryhmässä on kirjoitusvirhe, ohjelma kertoo siitä eikä yritä avata tiedostoa. Jos avain käy, ohjelma pyytää uuden ylläpitäjän salasanan eikä jatka ennen kuin salasana on asetettu.

**Jos avain katoaa tai joku muu näkee sen.** Jos tiedät vielä ylläpitäjän salasanan, avaa tiedosto ja luo uusi palautusavain. Nykyinen paperi ei enää avaa tätä tiedostoa. Vanha kopio, esimerkiksi USB-varmuuskopio ennen vaihtoa, aukeaa yhä vanhalla paperilla. Hävitä sellaiset kopiot, tai vaihda data-avain, jos entisellä ylläpitäjällä voi olla kopio.

**Jos molemmat salasanat ja paperi katoavat.** Jos molemmat ylläpitäjän salasanat ja tämä palautusavain katoavat, kisa-tiedostoa ei voi avata. Avainta ei voi nollata, eikä kellään muulla ole siitä kopiota. Tiedoston nimet, tulokset ja suostumukset katoavat.

## Passwords

Checked when a password is set or changed. Unlock does not re-check the list, so a later growth of the list does not lock the file.

- Minimum length is 10 Unicode code points after NFKC. Shorter input is `PASSWORD_TOO_SHORT`.
- Maximum length is 128 Unicode code points after NFKC. That is above the required floor of 64. A password of 64 code points is accepted when it is not on the common-password list. A password of 129 code points is `PASSWORD_TOO_LONG`. The app does not truncate.
- The UTF-8 form passed to Argon2id is at most 512 bytes. Input that exceeds that after the code-point cap is `PASSWORD_TOO_LONG`.
- Whitespace-only passwords and passwords containing a NUL are rejected.
- The password is compared, as a whole string, with a common-password list shipped in the repository (at least the 1000 most common passwords, file loaded from disk, no network fetch). Comparison is exact equality on the NFKC string after ASCII case-folding. A long passphrase that merely contains a common word is not rejected for that substring. `password` and `password123` are rejected. If the list file is missing or empty, password setup fails closed.
- There is no composition rule (no required digit or symbol).
- The two admin passwords must not be equal at setup, on change, or on reset.
- Each new password is typed twice and the two entries must match.

The KDF input is the NFKC UTF-8 bytes with case preserved.

## User-facing strings

The implementation PR adds these keys to `packages/i18n/locales/en.json` and `fi.json`. Guided hints use `HintFrame` and render only while guided mode is on. This documentation change does not edit the locale files.

| Key | English | Finnish |
|---|---|---|
| `unlock.password` | Password | Salasana |
| `unlock.open` | Open the file | Avaa tiedosto |
| `unlock.failed` | That did not open the file. | Tiedosto ei auennut. |
| `unlock.wait` | Wait before trying again. | Odota ennen uutta yritystä. |
| `unlock.useRecovery` | I don't have the passwords | Minulla ei ole salasanoja |
| `unlock.recoveryKey` | Recovery key | Palautusavain |
| `unlock.recoveryChecksum` | This recovery key has a typing error. Check the groups against the paper. Nothing was unlocked. | Palautusavaimessa on kirjoitusvirhe. Vertaa ryhmiä paperiin. Tiedostoa ei avattu. |
| `unlock.paramsRejected` | This file's key settings are not allowed, so it was not opened. | Tiedoston avainasetukset eivät ole sallittuja, joten sitä ei avattu. |
| `unlock.headerInvalid` | This file cannot be opened. | Tätä tiedostoa ei voi avata. |
| `unlock.newAdminPassword` | Set a new admin password to continue. | Aseta uusi ylläpitäjän salasana jatkaaksesi. |
| `unlock.unrecoverable` | If both admin passwords and this recovery key are lost, the race file cannot be opened. There is no way to reset it and no one else has a copy of the key. The names, results and consents in the file would be gone. | Jos molemmat ylläpitäjän salasanat ja tämä palautusavain katoavat, kisa-tiedostoa ei voi avata. Avainta ei voi nollata, eikä kellään muulla ole siitä kopiota. Tiedoston nimet, tulokset ja suostumukset katoavat. |
| `unlock.hint.password` | Either admin types their own password here. A wrong password does not say which admin it was. | Kumpikin ylläpitäjä kirjoittaa oman salasanansa tähän. Väärä salasana ei kerro, kummasta ylläpitäjästä on kyse. |
| `unlock.hint.recovery` | Type the printed groups, including the last group. The program checks for a typing error before it tries to open the file. | Kirjoita tulostetut ryhmät, myös viimeinen. Ohjelma tarkistaa kirjoitusvirheen ennen kuin se yrittää avata tiedoston. |
| `keys.oldCopies` | Changing this password does not lock old copies. A USB backup made earlier still opens with the old password. If a former admin may have a copy, rotate the data key and destroy the backups you still have. | Salasanan vaihto ei lukitse vanhoja kopioita. Aiempi USB-varmuuskopio aukeaa yhä vanhalla salasanalla. Jos entisellä ylläpitäjällä voi olla kopio, vaihda data-avain ja hävitä varmuuskopiot, jotka sinulla vielä on. |
| `keys.rotateLeftover` | A copy you do not have anymore stays readable. This program cannot erase someone else's stick. | Kopio, joka ei ole enää sinulla, pysyy luettavana. Ohjelma ei voi hävittää toisen henkilön tikkua. |

`unlock.unrecoverable` is shown at setup, on the print view, on the recovery screen, and in the guide. `keys.oldCopies` is shown when changing or resetting an admin password. `keys.rotateLeftover` is shown at the end of DEK rotation.

## Errors

| Code | When |
|---|---|
| `UNLOCK_FAILED` | Wrong password, checksum-valid wrong recovery key, GCM failure, body integrity failure, or a backoff wait. No slot id in the body. `retryAfterMs` is allowed during a wait. |
| `RECOVERY_KEY_CHECKSUM` | Recovery key fails the alphabet or the checksum. No KDF and no GCM. |
| `KEY_PARAMS_REJECTED` | Any slot is below the Argon2id minimum, above the ceiling, or using a KDF the slot type forbids. No KDF. |
| `FILE_HEADER_INVALID` | Magic, version, length, reserved bytes, or nonce length is wrong. |
| `PASSWORD_TOO_SHORT` | Fewer than 10 code points. |
| `PASSWORD_TOO_LONG` | More than 128 code points, or UTF-8 over 512 bytes. |
| `PASSWORD_COMMON` | On the bundled list. |
| `PASSWORD_MISMATCH` | The two typed copies differ, or the two admin passwords are equal. |

These codes are added to `docs/api/ERROR_CODES.md` in the implementation pull request. User-visible sentences come from the string table, not from raw code names, except where the existing app already shows a code in a test id.

## Tests

The implementation pull request adds these tests. None of them are in the documentation change.

| Test | Asserts |
|---|---|
| DEK width | The generated DEK is 32 bytes and comes from the CSPRNG interface the test stubs. A second file gets a different DEK. |
| Disk scan | After create, rewrap, recovery regeneration and rotation, the data directory does not contain the raw DEK or its hex or base64 forms, nor the canary password or canary recovery text. |
| Either admin | Slot 0's password and slot 1's password each open the body. A wrong password returns `UNLOCK_FAILED` with no slot field. The test doubles the Argon2 function and observes two calls on a successful first-slot password and on a failure. |
| Nonce per wrap | After a rewrap, that slot's 12 nonce bytes differ, including when the password bytes are unchanged. All three slot nonces differ. A stubbed RNG that returns a nonce already in the header is called again. |
| Body nonce | Writing the same logical page twice under one DEK stores two different 96-bit nonces, and decryption with the nonces swapped fails authentication. A page-number-only nonce fails this test. |
| Header tamper | Flipping `envelope_version`, `memory_kib` (to a value still at or above 65536 and within the ceiling), `iterations`, `parallelism`, one salt byte, `kdf_id`, `slot_type`, or `file_id` makes unlock fail. The body does not open. |
| Downgrade | `memory_kib = 8192`, `iterations = 2`, and `parallelism = 0` each return `KEY_PARAMS_REJECTED` and do not call Argon2id. A file whose recovery slot is rewritten as Argon2id with `memory_kib = 1024` is refused as a whole, and the admin password does not open it. |
| Stored parameters | A fixture with `memory_kib = 131072`, `t = 3`, `p = 1` is derived with 131072 KiB. Deriving it with 65536 does not verify the tag. |
| Salt | Each slot salt is 16 bytes. Rewrap replaces the salt. Salts differ across slots. |
| Checksum | One altered Crockford character returns `RECOVERY_KEY_CHECKSUM` and does not call HKDF or GCM. Alias input `O`, `I` and `L` unlocks when the rest of a valid key is correct. |
| Recovery gate | A valid recovery key opens the body and blocks normal navigation until one admin slot has been rewrapped. The other admin slot's bytes are unchanged if only one password was set. |
| Single-slot rewrap | After an authenticated reset of slot 1, slot 0's 96 bytes are equal and a hash of the body is equal. Slot 1's old password fails. Slot 1's new password opens the file. The acting admin's password still opens it. An unauthenticated caller cannot rewrap. |
| Old copy | A byte copy taken before the rewrap still opens with the old password. The test exists so the limitation stays true and documented. |
| Rotation | After DEK rotation the old recovery key fails on the new file, the new recovery key is required to have been observed by the test harness only inside the returned show-once buffer, the new admin passwords open the new file, and a preserved pre-rotation backup still opens with the old password. Participant bytes round-trip. |
| Backoff | The first five failures schedule no extra wait. After the fifth, the next attempt waits 1 second, then the wait doubles up to 900 seconds. The record is still there after the test reloads the module (the restart). A clock moved backward does not shorten the wait. Deleting the JSON is the documented reset, asserted so the threat model stays honest. Success writes `failureCount: 0`. A checksum failure increments the same counter. The response JSON has no slot field. |
| Zeroize | The test's KEK buffer is all zeros after unwrap returns, including the failure path. The DEK buffer the storage module owns is all zeros after close. |
| Logs | Captured logs, the thrown error's message, and the crash serializer do not contain the canaries or the DEK encodings. |
| Passwords | 9 code points are rejected. 10 are accepted when not on the list. 64 are accepted when not on the list. 129 are rejected and the stored wrap does not exist (no truncation). `password123` is rejected. Two equal admin passwords are rejected. |

## Implementation note

The pull request that adds code follows this spec and names Santtu as the security reviewer. It does not start from this text alone. Santtu's approval is a comment on [#131](https://github.com/Vihvila92/Easy-Race-Timer/issues/131).
