# ADR 0012: Key management for the encrypted race file

- Status: proposed. Implementation of [#131](https://github.com/Vihvila92/Easy-Race-Timer/issues/131) starts only after Santtu approves the spec on that issue. This ADR is not that approval.
- Date: 2026-10-21
- Spec: [../spec/key-management.md](../spec/key-management.md)

## Context

Issue [#130](https://github.com/Vihvila92/Easy-Race-Timer/issues/130) stores every race in one SQLCipher file encrypted with one random 256-bit data key (DEK). That issue allows a dev key provider. Issue [#131](https://github.com/Vihvila92/Easy-Race-Timer/issues/131) is the real key handling: the DEK must never be written unwrapped, two admins must each be able to open the file, and a printed recovery key must open it if both passwords are lost.

The club's copy of the file lives on a laptop and on USB backups. A person who picks up that stick must not be able to read names, birth years, consents or results. A former admin who kept an old copy is a different case from a stranger, and a password change on the current file does not reach that old copy.

Santtu's review on [#131](https://github.com/Vihvila92/Easy-Race-Timer/issues/131#issuecomment-6308842611) requires this ADR to record the slot format and the threat model: what an attacker with the USB stick can and cannot do. The byte layout below is normative. Procedures, KDF limits, backoff, tests and the bilingual recovery guide are normative in the spec. Change both documents in the same pull request.

## Decision

One current race file holds one DEK. The DEK is 32 bytes from a CSPRNG (`crypto.randomBytes` or libsodium `randombytes_buf`). It is passed to SQLCipher as a raw key through a Buffer API. It is never a SQL string and never a passphrase that SQLCipher would stretch again.

The file starts with a 320-byte `ERTK` envelope. Three slots wrap the same DEK with AES-256-GCM and a 128-bit tag:

| Slot | Who | Key-encryption key |
|---|---|---|
| 0 | Admin 1 | Argon2id(password, per-slot salt) |
| 1 | Admin 2 | Argon2id(password, per-slot salt) |
| 2 | Recovery | HKDF-SHA-256 of a 160-bit paper key |

Argon2id is the password KDF because those secrets are low-entropy. The recovery key already has 160 bits of entropy, so a memory-hard KDF would not raise the offline cost. HKDF only expands it to a 256-bit AES key. New admin slots store `m = 64 MiB` (65536 KiB), `t = 3`, `p = 1`, Argon2 version `0x13`, and a 16-byte salt. Unlock refuses an Argon2id slot below that minimum, or above the resource ceiling in the spec, before it runs the KDF.

Each wrap uses a fresh random 96-bit GCM nonce, including every rewrap. The body encryption under the DEK uses its own unique nonce per page write. A nonce that is only the page number is forbidden, because rewriting the page would reuse it. SQLCipher 4's default AES-256-CBC page IV does not meet that rule; [#130](https://github.com/Vihvila92/Easy-Race-Timer/issues/130) has to select a stricter mode. Nonces are never reused with the same key.

Every stored header field that an attacker could edit to weaken a slot is GCM associated data. That includes the envelope version, the KDF id, the KDF parameters and the salt. Flipping any of those bytes makes unlock fail: the GCM tag fails, and a parameter taken below the minimum is refused before the KDF runs. The app refuses the whole file if any slot is below the minimum, so a weak wrap of the same DEK is not left on disk while another slot still opens.

Changing an admin password, or replacing an admin, rewraps only that slot: new salt, new nonce, same DEK, same database body. The other slots stay byte-for-byte. This does not protect old copies of the file. The current file is closed to a former admin by rotating the DEK, re-encrypting the body, rewrapping every slot, and regenerating the recovery key, then destroying backups this operator still controls. A copy that has already left stays readable. Rotation does not erase a stick the program cannot see.

Wrong passwords and wrong recovery keys share one backoff record in `{data directory}/unlock-backoff.json`. The delay increases after 5 failures, is capped at 15 minutes, and is written and `fsync`ed before the KDF so it survives a restart. The record contains no secret. Deleting it, or attacking a copied file on another machine, clears the online delay. Argon2id and the recovery key's entropy are what limit an offline attacker. The error text does not say which slot failed.

Both admin passwords and the recovery key are required at creation. The recovery key is shown once, with a checksum, and is never stored in the file or in logs. If both passwords and that paper key are lost, the data cannot be recovered. There is no escrow and no cloud KMS.

Login sessions and the swappable auth provider are [#132](https://github.com/Vihvila92/Easy-Race-Timer/issues/132). The v0.1 event PIN is unchanged by this decision.

## Slot format

All multi-byte integers are big-endian. Version 1 is a fixed 320-byte header. The SQLCipher body starts at offset 320.

### Envelope prefix (32 bytes)

| Offset | Size | Field | Version 1 value |
|---:|---:|---|---|
| 0 | 4 | magic | `45 52 54 4B` (`ERTK`) |
| 4 | 2 | `envelope_version` | `1` |
| 6 | 2 | `header_length` | `320` |
| 8 | 16 | `file_id` | CSPRNG, not secret. Stays the same across DEK rotation |
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

Assets are the personal data and race records inside the file, the DEK, the two admin passwords, and the recovery key.

The attacker this section is written for has the USB stick (the race file, the `backups/` copies, and `unlock-backoff.json`) and their own computer. They do not know either password or the recovery key. They can edit or delete files on the stick.

### What that attacker can do

- Copy the file and guess offline. The backoff file does not apply on a machine that ignores it, and deleting `unlock-backoff.json` resets the delay on the club laptop. Offline password guesses pay the full Argon2id cost (`m = 64 MiB`, `t = 3`, `p = 1`) for each guess on each admin slot.
- Read the envelope: magic, version, file id, salts, nonces, KDF parameters, ciphertext and tags. Those fields are not secret. The header is authenticated, not encrypted.
- See that the file is an Easy Race Timer envelope. Hiding that fact is not a goal.
- Flip header bits. The app then fails closed: either `KEY_PARAMS_REJECTED` when a parameter is below the minimum or above the ceiling, or `UNLOCK_FAILED` when the tag does not verify. Availability of that copy is lost. Confidentiality is not.
- Restore an older backup they also hold. That backup still opens with the passwords and recovery key that were current when the backup was made. Replacing one admin, or rewrapping one slot, does not change this.
- Splice an old admin slot back into a file whose DEK was not rotated. The old slot still unwraps the same DEK. Opening the current body is then possible with the old password. Splicing an old slot into a file whose DEK was rotated yields the old DEK, which does not open the new body.

### What that attacker cannot do

- Read names, birth years, contact details, consents, results, the audit log or in-file accounts from the file bytes.
- Unwrap the DEK without a current admin password or the current recovery key.
- Change the format version, KDF id, KDF parameters, salt, nonce or slot type and still have the GCM tag verify.
- Persuade this app to run Argon2id below `m = 64 MiB`, `t = 3`, `p = 1`. A file with any slot below the minimum is refused as a whole, so a weak extra wrap cannot sit beside a strong one.
- Learn from the app's error which admin slot was tried, whether an account exists, or whether the password was close. The locked screen has one password field and always runs both admin KDFs.
- Guess the recovery key in practice. It has 160 bits of entropy. The checksum is a typo check over a public format, not a shortcut to the key.
- Recover the data if both admin passwords and the recovery key are lost. Nobody, including the authors of this program, has a spare key.

### Other actors

- A person who has the printed recovery key can open the current file. The app then requires a new admin password before normal use. They can also open any backup made while that same recovery slot was current.
- An admin who still knows a current password can open the current file, replace the other admin's slot, and regenerate the recovery key. Old copies keep the old wraps until the DEK is rotated and those copies are destroyed.
- A former admin who may still hold a copy is not locked out by a slot overwrite. The required procedure is DEK rotation plus destruction of backups this operator still controls. Copies already in the former admin's hands stay readable. This program cannot erase a stick it does not have.
- A debugger on an unlocked process, or malware running as the club user, can read the DEK while the file is open. That is a compromised device and is out of scope for this control. Zeroizing Buffers and redacting logs limit leftovers. They do not stop the debugger. Swap and hibernation can retain key bytes; `mlock` is best-effort and is not claimed as a guarantee.
- The online backoff slows guessing through this app's unlock screen and still applies after a process or OS restart. It is not a lock that the USB-stick attacker has to break.

## Consequences

- The implementation PR for [#131](https://github.com/Vihvila92/Easy-Race-Timer/issues/131) follows [the spec](../spec/key-management.md) and does not start before Santtu's approval comment.
- [#130](https://github.com/Vihvila92/Easy-Race-Timer/issues/130) still owns SQLCipher, migration and backup bytes. It must meet the body nonce rule in this ADR. Pre-migration `.bak` files and scheduled backups are whole-envelope copies, with the same slots and the same DEK as the file they copied.
- A password change is a cheap header rewrite. Cutting off a person who may have a copy is a full re-encryption and a manual backup cleanup. The UI has to say that in plain language.
- `unlock-backoff.json` is a new 0600 file next to the race file. It is not inside the encrypted body, because the count has to be updated before the DEK is known.
- Locale files, the print stylesheet and the tests listed in the spec are part of the implementation PR. This ADR adds no code.

## Alternatives considered

- One shared password and no paper key. The club cannot open the file if that one person is away, and there is no recovery path. Rejected.
- Argon2id on the recovery key as well. It does not move a 160-bit search, and it makes honest recovery slow. Rejected for the recovery slot only.
- A cloud KMS or a vendor escrow key. Out of scope, and it contradicts the "lost paper means the data is gone" rule.
- Rewrapping every slot on every password change, or re-encrypting the body each time. That still does not reach a USB copy that has already left, and it violates the requirement that the other slot and the data stay unchanged. Single-slot rewrap is the password-change operation. DEK rotation is the separate operation when a former admin may have a copy.
- An OS keychain as the only place the DEK lives. The file on a backup stick would then be unopenable on another computer, which is the club's recovery path. A keychain may be added later. It does not replace the envelope.
