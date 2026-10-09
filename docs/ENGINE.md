# CopyPaster engine

**CopyPaster stores original evidence first, then builds a replaceable layer of understanding around it.**

This file sets out what CopyPaster's data means and what the code is allowed to do with it. Every feature has to fit these rules. The plan for building them lives in [PLAN.md](PLAN.md).

## Words

| Word | Meaning | In code |
|---|---|---|
| **Profile** | A separate set of data on the device (Personal, Work, Family) | `profiles`, one IndexedDB database each |
| **Space** | A part of life inside a profile (Health, Food, Trips) | `groups` store |
| **Sub-chat** | A kind of entry inside a space (Prescriptions, Bills) | `group.subs` |
| **Entity** | A reusable person, place or thing with one identity | `entities` store |
| **Type** | What kind of entity it is (Doctor, Restaurant, Vehicle). Defines its fields. | `entity.type` |
| **Page** | A space's view of an entity: the entity's entries in that space, its stats, its tabs | `group.mainTags[]`, each `{ id, entity, color }` plus a display copy of the name and one-line summary |
| **Entry** | Something that happened, or a document | `entries` store, linked to spaces by `refs` |
| **Source** | The original thing captured (a photo, a file) plus how and when it was captured | `capture` on a note or entry: the original, time, origin, file name, location |
| **Field** | A value that describes an entity or an entry, from the one field engine | `group.fields.custom`, `entity.fields` |
| **Tag** | A quick label shared by notes and entries | `tags` store; entries keep the key |
| **Suggestion** | A value the app guessed. It is not a fact until confirmed. | not built yet (2.7) |

People see these simply as *Personal → Health → Dr X → Prescriptions*. The table is for builders.

## Rules

1. The original is never changed. It can always be fully deleted.
2. Saving never waits for understanding: capture first, understand later.
3. Capture succeeds even when OCR, AI, location, enrichment or the network fail.
4. OCR and AI output is a suggestion until a person confirms it.
5. A captured source keeps its available capture details: time, origin, original file name, and location with its accuracy and source.
6. A suggestion keeps where it came from, how confident it is, and whether it is confirmed.
7. One entry can sit in several spaces without being copied.
8. An entity has one stable identity (its `id`).
   - Renaming it or changing its type never makes a new one.
   - A detail such as a specialty never becomes its identity.
   - A page is a view of the entity, never a second copy.
9. Spaces give context; they don't own entries.
10. Views (Timeline, pages, calendar, stats) never store duplicate data. Stats are worked out from entries and fields.
11. Outside services enrich or import; they are never the source of truth.
12. AI asks the engine; it doesn't own the memory. It receives only the records a request needs.
13. OCR text is a throwaway search index. Search helps you find it; the original tells you what it is.
14. Private by default. Nothing leaves the device unless the person turns on a destination. Before sensitive data is sent, CopyPaster shows what will be sent and where.
15. Nothing is discoverable: no public pages, no directory of people.
16. Sharing is explicit, per person, time-limited and revocable. A Card is a copy, not a published page.
17. Deleting here is not deleting there: data already sent to an outside service may still exist there.

## Field or entry?

If it **describes** the thing, it's a field. If it **happened on a date**, it's an entry.

```
Doctor → Specialty: Dermatology        field of the entity
Doctor → Clinic: (a place entity)      field of the entity
Bike → Insurance expiry: 14 Mar 2027   field (and a reminder)
Visit on 7 Oct 2026                    entry
Prescription on 7 Oct 2026             entry
```

## One field engine

Spaces, entities and (later) documents all use the same field definitions: `{ id, name, type, unit }`.

| Type | Holds | Notes |
|---|---|---|
| `text` | Free text | |
| `number` | A number, with an optional unit | Can show as a total or latest value in a space header |
| `date` | A day | |
| `expiry` | A day something runs out | Turns into a reminder |
| `phone` | A phone number | Shown as text you can copy |
| `place` | A link to a place entity | |
| `person` | A link to a person entity | |

Amount and rating stay as the built-in space fields they already are.

## Types

A type is a name plus field definitions, a kind (person, place or thing) and an icon. Built-in types ship with the app; people can make their own. Types stay shallow: "Doctor" with a Specialty field, never a tree like Medical → Doctor → Dermatologist.

Adding a field to one entity asks whether to add it to the type. If yes, future entities of that type get it; existing ones don't suddenly show empty boxes.

## Snap

- Snap saves the source first. Nothing is required before saving.
- A global snap lands in the Inbox as a note marked `captured`, shown under Inbox → Snaps. Giving it a title, text, folder or tag counts as sorting it out.
- A snap from inside a space, page or sub-chat saves straight into that context.
- Location is fetched in the background and added when it arrives. It never delays the save.
- Coordinates are evidence; a map match would only be a suggestion. The place a person picks is what counts.
- A guess at what a photo shows is made on the device and stored as `suggest` `{ kind, label, detail, confidence, source, at, confirmed }`. It is a suggestion (rule 4): it never files, renames or tags anything by itself.
- "From Inbox" in a space moves the captured note into that space as an entry, with its capture details. It is moved, never copied.
- The photo shown in lists is a smaller copy; `capture.original` keeps the file as it was picked (up to 15 MB).

## Sync (2.7)

Stash still has no server. Sync writes from the phone straight to the user's
own Google Drive (`sync.js`, `sync-core.js`).

- Sign-in: Google Identity Services token client, scope `drive.file` only, so
  Stash sees just the files it makes. The OAuth client ID belongs to the user
  and is typed into Settings → Sync; none is in the code. Tokens last an hour;
  after that, the next sync needs a tap.
- Folder: "Stash" ("Stash - Profile" for other profiles). Inside it there's one
  Markdown file per space, `Notes.md`, `Me.md`, `README.md` and, if on,
  `Stash backup.cps` (the same as Export).
- Readable files never hold Vault items, password items or deleted notes.
  Photos and files are only counted in them; the backup has everything.
- Each file's fingerprint is kept, so unchanged files aren't sent again. A
  space that's no longer synced has its file moved to Drive's bin.
- Readable files are one way: Stash → Drive. Edits made to them in Drive are
  overwritten. Restore from Drive adds what the backup has and this device
  doesn't (like Import).
- Auto-sync runs about 20 s after a change while signed in, when the app comes
  back to the front, and every 2 minutes while it's open.

### Two-way between devices

On by default ("Keep my devices in step"). Records (notes, tags, folders,
spaces, entries, people/places/things and custom types) go to a
"Sync data (don't edit)" folder as 16 shard files, keyed `store:id`, each with
a fingerprint. Each device keeps a base: the fingerprint it last agreed with
Drive for every key (localStorage, `copypaster-sync-state`). See `merge()` in
`sync-core.js`:

- only this device changed it → sent up; only another did → taken here;
  both did → the newer `updatedAt` wins.
- deletes are tombstones (kept 90 days). A record missing from Drive without a
  tombstone is sent again, never deleted, so two devices saving at once can't
  lose anything.
- before writing a shard, its Drive version is checked; if another device wrote
  it meanwhile, the round starts again.
- only shards whose contents changed are uploaded, and only shards whose
  version moved are downloaded.
- Vault items never sync (each device has its own Vault key). The note open in
  the editor isn't changed under you; it's picked up on the next sync.
