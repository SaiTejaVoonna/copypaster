# Groups

Groups are timelines for one topic each (Hospital, Food, Bike, Movies & Anime).
They are **separate from notes**: notes never show inside a group and group
entries never show in the notes list. Search (Ctrl K) finds both.

Off by default. Settings → Groups → Show Groups. Turning it off only hides
them.

## Files

| File | What |
|---|---|
| `groups-core.js` | The rules, no screen code: data shapes, templates, cards, totals, template validation. `window.CPGroupsCore`. |
| `groups.js` | The screens. Talks to the app only through the `api` object passed to `CPGroups.init()` from `startGroups()` in `index.html`. |
| `groups.css` | Styles, built on the app's design tokens. |

## Storage

Two IndexedDB stores in each profile's own database, added in DB version 5:
`groups` and `entries`. The `items` store (notes) is untouched.

**Group**: `{ id, name, desc, icon, color, cover, subs[], mainLabel, mainTags[], fields, cards, cardWord, order }`

- `subs`: sub-chats `{ id, name, label (one entry is a…), icon, color, late, noTag, noStatus }`
- `mainTags`: the thing the group revolves around (doctor, place, title) `{ id, name, color, info }`
- `fields`: `{ amount: { on, currency }, rating, custom: [{ id, name, type: number|text|date, unit, stat: none|sum|latest }] }`
- `cards`: `none` | `day` (same day + same main tag = one card; sub-chats marked `late` join up to 7 days later) | `title` (same main tag = one card)

**Entry**: `{ id, refs: [{ g, s, tag }], title, note, tags[], amount, currency, rating, fields{}, photos[], link, happenedOn, addedOn }`

- `refs`: one entry can be in several groups (linked, not copied). Each ref has its own sub-chat and main tag.
- `amount` is in minor units (paise, cents). Totals are per currency, never converted.
- `photos` are JPEG data URLs, shrunk to 1600px on the way in (which also drops location data).

Every count, total and card is computed from entries when shown. Nothing is stored twice.

## Delete rules

- Entry in one group: **Delete** (gone) or **Move to Notes** (becomes a normal note with its text, photos and details written out).
- Entry in several groups: **Remove from this group** (stays in the others) or **Delete everywhere**.
- Deleting a group: keep its entries as notes, or delete them. Entries also linked into another group stay there.
- Removing a sub-chat or main tag in Edit group keeps its entries in the group, under All / no tag.

## Backups

Export adds `groups` and `entries` and sets `cpsVersion: 2`. Older versions of
the app read `items`, `tags` and `folders` and ignore the rest, so new backups
still restore there (without groups). Old backups have no groups and import as before.

## Templates

A template is the setup only: name, icon, colour, sub-chats, main tag label,
fields and card rule. Never entries, photos, amounts, main tags (doctor or
place names) or the cover photo.

Shared as a file (`.cptemplate.json`) or a link (`#template=<base64url JSON>`).
Imports go through `validateTemplate`: unknown keys dropped, lengths capped,
icons and colours checked against fixed lists. User text is only ever set with
`textContent`.
