# CopyPaster 2.5: the core

*Release 1 of the v3.0 plan. Everything here works offline, needs no account and keeps data on the device.*

## Files

| File | What |
|---|---|
| `search-core.js` | Smart search words (`#tag group: date: type: is:`), date ranges. `window.CPSearch`. No screen code. |
| `password-core.js` | Password rules: simple, exact counts, words, PIN, easy to type, strength. `window.CPPassword`. |
| `totp-core.js` | 2FA codes (TOTP, RFC 6238), otpauth links, base32. `window.CPTotp`. |
| `tools.js` | Sheets for the password builder, 2FA setup and code, voice recorder, sketch pad. `window.CPTools`. |
| `timeline.js` | The Timeline pane and its filter bar. `window.CPTimeline`. Gets plain rows from the app; never touches storage. |
| `tools.css` | Styles for all of the above, on the app's tokens. |

`index.html` wires them in (`startTimeline()`, `toolsApi`, the shared tag functions) and `groups.js` adds `timelineRows`, `openEntry`, `tagCounts`, `renameTag`, `removeTag`, `openComposer`.

## The dock (phones)

Inbox · Groups · **+** · Search · More. The + opens the New menu (note, paste, command, password, photo, checklist, voice note, sketch, group entry, snap to group, folder). Search opens the Timeline with the keyboard up. More opens the full menu (folders, tags, Vault, Archive, Trash, password generator, settings). The floating + and the ☰ button are hidden on phones, so there's one of each. With Groups switched off, Favorites takes the Groups spot. Groups are on by default from 2.5.

## Timeline and smart search

Every note (not Vault items, not Trash) and every group entry, newest first, with month and day headings. Notes are placed by when they were made, entries by when they happened.

One filter bar: Search, Group, Tag, Date, Type, Sort. The search box is the single source of truth: picking from a menu adds words to it, and each word shows as a chip with ✕.

| Word | Means |
|---|---|
| `#lab`, `#"Apollo Hospital"` | has this tag (notes and entries) |
| `group:hospital` (start of the name is enough), `in:notes` | one group, or notes only |
| `date:today` `yesterday` `week` `month` `3m` `year` `2026` `2026-03` `2026-03-14` | when |
| `after:2026-01-01` `before:2026-02-01` | a range |
| `type:note` `checklist` `command` `link` `photo` `voice` `sketch` `entry` | kind |
| `is:fav` `pinned` `unread` `todo` `doing` `done` `reminder` `archived` | marks |

The notes list's own search box understands the same words. Sort: newest, oldest, recently edited, highest amount, highest rated, A–Z (remembered on this device).

Computers: a Timeline item in the sidebar, **T** to open or close it, **/** to search it, **F** for filters. A note opens beside it; a group entry opens in its group. Phones: one Filter button opens a sheet with every filter; back closes a note, then clears the search, then leaves.

## Shared tags

Notes keep tag records (name, colour, icon) in the `tags` store. Group entries keep a tag's short key: `Apollo Hospital` → `apollo-hospital`. The two meet on the key, so one tag means the same thing everywhere:

- Sidebar counts and the Tags page count notes and entries together.
- `#word` typed in a group's send bar becomes a tag (and leaves the text). Entries use the same picker as notes, with the same tags.
- Tapping a tag on an entry or in the Timeline shows everything with it. A tag's notes view links to its group entries.
- Renaming a tag renames it on entries; deleting it removes it from both; tags that existed only on entries get a record when the app starts.

**Settings → Tags:** every tag with its counts; Show, Edit (name, colour, icon), Merge into another, Delete; look-alikes (`apollo` / `apollo-hospital`, `breakfast` / `breakfasts`) with one-tap Merge; delete all unused tags.

## Notes

- **Checklist** (`item.checklist: [{ id, text, done }]`): the Checklist button turns each line into an item; off turns the items back into ☐ / ☑ lines. Enter adds the next item, Backspace on an empty one removes it, done items sit under the rest with "Clear done". Copy copies the ☐ / ☑ lines. Rows show `2/5`.
- **Status** (`item.status: "todo" | "doing" | "done"`): Organise → Status. A pill on the row; `is:todo` etc.
- **Reminders** (`item.remindAt`, `item.reminded`): Organise → Remind me (in 1 hour, this evening, tomorrow morning, next week, or a time). When it's due: a sticky message with Open, a system notification if allowed (asked the first time), and the note shows Due with Snooze 1 hour / Done. A Reminders view lists them (Due, then Upcoming). Browsers only run this while CopyPaster is open; a closed app catches up when it opens. Not offered for Vault items.
- **Voice notes** (`item.audio: [{ src, duration, mime, at }]`): up to 5 minutes, recorded on the device (Opus/WebM, or MP4 on iPhone) and kept as a data URL in the note.
- **Sketch**: a drawing pad (7 inks, 3 sizes, eraser, undo, clear) saved as a PNG photo on the note. "Draw on it" on a photo saves a drawn-on copy. `item.sketches` remembers which photos are drawings (for `type:sketch`).

All of these are part of the note, so they're encrypted in the Vault, exported in backups and ignored by older versions of the app.

## Passwords and 2FA

**Password builder** (Generate in a login, or More → Password generator, or Ctrl K):

- Simple: length 4–64, capitals, small letters, numbers, special characters (each on at least once), your own list of allowed special characters, avoid look-alikes (`0 O o l 1 I |`).
- Exact: how many of each kind; one kind can fill the rest; wrong totals are blocked with a hint ("Remove 2, or raise the length to 14"); characters land in random places.
- Words (`river-tiger-cloud-42`), PIN, Easy to type (`abcdef-ghjkmn-pq7rSt`).
- Presets: Strong, No special characters, Easy to type, PIN, Memorable, plus up to 12 of your own (saved on this device).
- Strength in bits of randomness and a rough time to guess (10 billion guesses a second). Everything uses `crypto.getRandomValues` with rejection sampling.

**2FA codes** (`item.login.totp: { secret, issuer, account, digits, period, algorithm }`): Add 2FA code on a Vault login; scan the QR code (where the browser can: Chrome on Android and computers) or paste the setup key / otpauth link. The 6-digit code updates every 30 seconds with a countdown ring; tap to copy (the clipboard clears after 30 s like other Vault copies). The setup key lives inside the login, so it's encrypted with the Vault. Only time-based codes (TOTP) are supported.

## Backups and storage

- Export remembers when; Settings → Your data says "Last backup N days ago".
- A gentle banner at the top of the Inbox when it's been longer than the chosen interval (every week, 2 weeks, month (default), or never) and there are at least 3 things: Back up now, or Later (3 days).
- Storage on this device: how much is used of what the browser allows, split into photos and sketches, voice notes, groups, text and locked Vault items.

## About

Settings → About shows "© 2026 Sai Teja Voonna. All rights reserved." and that nothing is collected. The repository has a `LICENSE` file saying the same.

## Tests

`tests/core25.spec.js` (desktop) and `tests/core25.phone.spec.js` (phone) cover the rules (password, RFC 6238 2FA vectors, search words), the password builder, 2FA in the Vault, checklists, status and reminders (with a fake clock), voice (a tone stands in for the microphone), sketches, the Timeline and its filters, shared tags (rename, merge, entry picker), shortcuts, the backup banner, storage and About.
