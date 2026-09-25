# Vault: how it works

*Built 25 Sep 2026 (roadmap v1.7). Code: the "Vault" and "Vault: screens" sections of `index.html`. Tests: `tests/vault*.spec.js`.*

## Keys

| Thing | What it is | Where it lives |
|---|---|---|
| **Vault key** | 32 random bytes, AES-256-GCM. Encrypts every Vault item. | Only in memory while unlocked. Zeroed on lock. |
| **Password copy** | The vault key, encrypted with a key from your password (PBKDF2-SHA256, 600,000 rounds, random salt). | `meta` store, record `vault` |
| **Recovery copy** | The vault key, encrypted with a key from the 24-character recovery key (PBKDF2, 100,000 rounds; the recovery key itself has 120 bits of randomness). | same record |
| **Passkey copies** | The vault key, encrypted with a key from the passkey's PRF output (HKDF-SHA256). One per Face ID / fingerprint passkey. | same record, `passkeys[]` (not exported: passkeys belong to one device) |

Changing the password re-encrypts only the password copy. Items never need re-encrypting.

Every encryption uses a fresh random 12-byte IV. Each item's ciphertext is bound to its id (AES-GCM additional data), so a record can't be swapped onto another item.

## What's stored for a Vault item

Readable: `id`, `schemaVersion`, `vaulted`, `createdAt`, `updatedAt`, `deletedAt`, `autoExpireAt`, `order`.
Encrypted (`enc: { iv, ct }`): everything else, including title, text, photos, tags, folder, color, type and run history.

The readable fields let Trash, restore, auto-delete and the 30-day clean-up work while the Vault is locked.

## In the app

- **All saving** goes through `saveItems()`, which encrypts Vault items on the way to disk. That's the only place.
- **While locked**, each Vault item in `cache` is a *stub* (`_locked: true`) carrying its encrypted record. Stubs render as "Locked item", can't be opened, selected, searched or copied, and only their readable fields can change.
- **A save that races a lock** (for example, auto-lock during the Delete animation) keeps only the readable part of the change, with the stored ciphertext.
- **Backups** contain Vault items exactly as stored, plus the wrapped keys (no passkeys). Importing into:
  - a device without a Vault: adopts that Vault, and the same password opens it.
  - a device with the same Vault: the items import as they are.
  - a device with a different Vault: asks for the other Vault's password or recovery key, then re-encrypts the items with this Vault's key (or skips them).

## Password items

A third item type, **Password**, that only exists in the Vault. It has a name, website, username, password (Show / Copy / Generate, with a strength hint) and notes. They're stored in `item.login = { url, username, password }`, inside the encrypted part like everything else. Copying clears the clipboard after 30 s. A Password item can't be moved out of the Vault; change it to a Note first. The generator makes 20 characters with every kind (upper, lower, digit, symbol), using `crypto.getRandomValues` with rejection sampling.

## Known limits

- Lost password and lost recovery key means the items are gone. That's the design.
- Protects data at rest: a stolen device, a copied backup, someone reading browser storage. It doesn't protect against malware on the device while the Vault is unlocked.
- **Moving an existing note into the Vault:** the browser may keep old unencrypted copies in its storage files until it compacts them. For real secrets, create or paste them inside the Vault view, so they're encrypted from the first save.
- Clipboard clearing only works while CopyPaster is in front; browsers block clipboard writes from the background.
- Face ID / fingerprint unlock needs passkeys with the PRF extension: recent Chrome/Edge/Android, Safari 18+ on iPhone/Mac. Elsewhere the setting either doesn't show, or explains it can't be turned on.
