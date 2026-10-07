# CopyPaster plan (working draft)

*Shared summary of the plan as of 7 Oct 2026. A working draft for discussion, not a promise. Personal examples are left out on purpose.*

## Status

- Live site (`main`): **v2.0**.
- **v2.5** (Groups + Core) is in pull request #1 with 108/108 tests passing, waiting for the owner's merge.
- Nothing goes live without the owner's "ok".
- The repo layout stays as it is. `index.html`, `sw.js` and the tests depend on file paths, so there will be no folder restructure.
- The old `Copy-Paster` repo (first version) is superseded by this one.

## Versions

Versions 2.1–2.4 were never released. From now on there are no gaps.

| Version | Phase |
|---|---|
| 2.5 Core (in PR) | Dock, global Timeline with smart search (`#tag group: date: type: is:`), shared tags, checklists, status, reminders, voice notes, sketches, password builder, 2FA codes, backup reminder |
| 2.6 | Phase 1: Fix and Foundation |
| 2.7 | Phase 2: Documents and Safety |
| 3.0 | Phase 3: Beta and Outside World (only if it deserves 3.0) |

## Phase 1 (2.6): Fix and Foundation

**Fixes from phone testing:**
- Filter sheet spacing.
- Custom dates on phones.
- Exclude filters (`-#tag`, `-group:`).
- A dock you can change, with Timeline as its own tab.
- Tags and "+ New" in the group message bar.
- Rating stars cut off.
- Photo-only entry titled with the type name.
- New place capitalisation.
- Duplicate names in the "Main tag" picker.

**Words used from now on:**

| Word | Means | Example |
|---|---|---|
| **Space** | What the app calls "Profile" today: a separate set of data | Personal, Work, Family |
| **Group** | A part of life, inside a space | Hospital, Food, Bike |
| **Entity** | A reusable person, place or thing with one identity | Dr X, Nimrah Cafe, the bike |
| **Page** | A group's view of an entity | Hospital → Dr X |
| **Sub-chat** | A kind of entry inside a group | Prescriptions, Bills |
| **Entry / Source** | Something that happened / its original photo or file | A prescription and its photo |

People see it simply as **Personal → Hospital → Dr X → Prescriptions**. Under the hood, a page points to its entity; it never copies it.

**Spaces (today's "Profiles"):**
- "Profile" is never used for people or places. Doctors, restaurants and vehicles are entities with pages, not profiles.
- The visible label changes from "Profile" to **"Space"**. This is a text change only: stored data, switching and existing spaces keep working exactly as they do.

**The foundation:**
- `docs/ENGINE.md`: a short set of rules.
- **One field engine:** the existing group fields, plus phone, person, place and expiry.
- **Entities: Person / Place / Thing with a Type** (Doctor, Restaurant, Vehicle, Anime, your own).
  - Type is the only category, and stays shallow.
  - Specialty is a field of Doctor, not a category.
  - One stable identity: renaming or changing the type never creates a new entity.
- **Pages inside groups, Instagram-style:**
  - Circles at the top of a group open that entity's page for this group.
  - The group's sub-chats become the page's tabs.
  - Stats (visits, total spent, average rating, first and last visit) are worked out from entries and fields, never stored by hand.
  - The same entity in another group has its own page there ("Also in Insurance"). Same identity, different context, no duplicate entries.
  - Merge for accidental duplicates.
- **Saving an entity needs only a name and a type.** "+ Add detail" comes later. Adding a field to one entity asks "Add to all Doctors?"; it's optional and leaves no empty boxes.
- **Date fields** (insurance expiry, follow-up) become reminders and calendar dots automatically.
- **Migration:** old "Main tag" choices become entities with pages, with a one-time Review screen.

**Snap: capture now, organise later**
- **Capture → Save → Done.** Boringly reliable, not an "AI camera".
- Saving works instantly and offline (once the app is installed). No group, entity, place, tag, OCR, AI, GPS, map or network is required. If any of those fail, the capture is still saved.
- **Global Snap** (from the + menu): saves into **Inbox, under a "Captured" filter**. No new storage area.
- **Contextual Snap** (from inside a group, page or sub-chat, e.g. Personal → Hospital → Dr X → Prescriptions): saves with that context already filled in. No form appears before saving.
- **Saved with each snap:** the original, time, origin (camera, photo library, file), original file name, and location with its accuracy and source when available.
  - Location is asked for in the background and never delays the save.
  - Coordinates are evidence. A map or web match is only a suggestion. The place you choose is what counts.
- **Snap another** for multi-page papers. Each page stays its own original; nothing is merged.
- **Organise later:** in a page's sub-chat, "Add captured item" links the existing original. It is never copied.
- Today's "Snap to group" asks where to save before saving. It changes to save first, with that choice optional.
- The design leaves room for OCR, AI, location lookup and entity matching to be added later without changing the capture flow. **None of that is built in Phase 1**, and there is no medical intelligence.

## Phase 2 (2.7): Documents and Safety

- Import PDFs and photos and keep the originals, with their capture details (time, location, origin, original file name) where available.
- Show and index each page of a PDF separately while the original PDF stays untouched.
- **Visit bundles:** related originals (prescription, pharmacy bill, lab report, payment) are grouped into one visit by date and place. The bundle is only a link between them; the originals are never merged or changed.
- Read printed text, used **only as a search index**. Suggested values (person, date, items, amount, follow-up) need a ✓.
- Match a printed pharmacy bill to a handwritten prescription. The bill gives exact names; the prescription gives the dosage.
- Review queue: "8 new, 3 need review".
- Backup and sync to the user's own WebDAV or cloud. App lock. Export.
- Cards and QR:
  - Share a person, place or template with people you choose.
  - Read UPI, vCard and Maps QR codes as suggestions.

## Phase 3 (3.0): Beta and Outside World

- Template packs: Hospital, Food, Travel, Vehicle, Movies & Anime, Home, Work.
- Calendar, Home tiles (On this day, Due soon) and Insights.
- Automations (repeating entries, auto-tags), with catch-up when the app opens.
- Connections: AniList, TMDB, Google Calendar, Plex.
- AI with the user's own key. It receives only the records the question needs; each request shows a preview and asks "Allow once".

## Engine rules

1. The original evidence is never changed, but it can always be fully deleted.
2. Saving never waits for understanding: capture first, understand later.
3. Capture succeeds even when OCR, AI, location, enrichment or the network fail. The photo is saved; the rest may come later.
4. OCR or AI output is a suggestion until confirmed with ✓.
5. Every captured source keeps its available capture details: time, location, origin and original file name.
6. Every suggestion (OCR, AI, web lookup) keeps where it came from, how confident it is, and whether it is confirmed.
7. One entry can sit in several groups without being copied.
8. People, places and things are reusable records with a stable identity. Renaming one or changing its type never creates a new one, and a detail like a specialty never becomes its identity. A page inside a group is a view of that identity, never a second copy.
9. Groups give context; they don't own entries.
10. Views never duplicate data.
11. Outside services enrich or import; they are never the source of truth.
12. AI asks the engine; AI doesn't own the memory. AI receives only the records needed for the current request, never the whole collection by default.
13. OCR is a throwaway search index. Search helps you find it; the original tells you what it is.
14. Private by default. Nothing leaves the device unless the user explicitly turns on a destination or connection. Before sensitive data is sent, CopyPaster shows what will be sent and where.
15. Nothing is discoverable: no public pages, no user directory.
16. Sharing is explicit, per person, time-limited and revocable. A Card is a copy, not a published page.
17. Deleting here is not deleting there (data already sent to AI or cloud).

**Field or entry?** If it describes the thing, it's a field. If it happened on a date, it's an entry.

```
Doctor → Specialty: Dermatology        field
Doctor → Clinic: Skin clinic           field
Bike → Insurance expiry: 14 Mar 2027   field (also becomes a reminder)
Visit on 7 Oct 2026                    entry
Prescription on 7 Oct 2026             entry
Payment on 7 Oct 2026                  entry
```

## Privacy

- Local-first. We store nothing on a server. No client secrets or AI keys in code.
- Wording: "Local-first. User-controlled. Nothing shared without permission." No compliance claims until a privacy lawyer has reviewed it, before any public cloud or AI launch.
- Real personal or medical documents never go in this public repo; tests use fake ones.
- No medical advice features. We organise and remind.

## Known limits

- A web app runs only while open, so it catches up when opened.
- Photos picked in the browser often lose their location.
- On-device OCR is good at print and weak at handwriting.
- Keeping originals needs backup or sync.
- iPhone needs a QR library.
- Some services have no open API (shopping sites, Letterboxd, hospital portals). Those come in through Gmail, CSV or PDF import.

## Next

1. Merge PR #1, which puts v2.5 live.
2. Then Phase 1 (2.6) starts.
3. Docs later: README, a CHANGELOG from real git history, `ENGINE.md`, and version tags.
