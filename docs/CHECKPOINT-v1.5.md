# v1.5 Checkpoint: stay plain JavaScript, or add a framework?

*Written 25 Sep 2026, after v1.1–v1.4 were built. This is a review and a recommendation. The decision is yours.*

## The question

The next big pieces are the **Vault** (encryption) and **Sync**. Both touch every save. The roadmap asks whether plain JavaScript can carry that, or whether a small state layer (e.g. Preact, ~3 KB) should come first. It also says: *don't migrate before the warning signs show up.*

## What the code looks like today

| Measure | Now | Notes |
|---|---|---|
| Size | 4,070 lines in one `index.html` (+ 60-line `sw.js`) | Was 3,212 at the start of this round |
| Shared mutable variables | 17 (`cache`, `currentId`, `currentView`, `selectedIds`, …) | All at the top level of one script |
| Places that save an item | 43 separate `await put(ITEMS_STORE, …)` calls | Each one also decides what to re-render |
| Re-render calls | `renderAllViews` ×30, `openDetail` ×26, `renderList` ×14, `renderNav` ×7 | Chosen by hand at each call site |
| Item editor | `openDetail()` is one 532-line function | Rebuilds the whole pane on every change |
| Event listeners | 119, wired inline while building the DOM | |

**How state works:** change the item object in memory → save it with `put()` → call whichever render functions seem right. There's no single place where "an item changed" happens.

## The three warning signs from the roadmap

1. **"State tangled across local, pending-sync and vault-locked."** *Not yet.* Sync and the Vault don't exist, so there's only one kind of state today.
2. **"Re-rendering by hand is causing bugs."** *Early signs, yes.* In this round alone:
   - The auto-delete label always said "just now", because it reused a function meant for past times, and nothing re-rendered it.
   - Starring from the list left the open item's star and timer stale. It needed a hand-written in-place update.
   - Re-rendering the whole editor can interrupt typing or drop a pending autosave, so newer features (auto-delete row, run history) rebuild only their own section instead.
   - "Opened" vs "re-rendered" had to be told apart by hand for read/unread.
3. **"Features feel slower to add."** *Slightly.* Every feature has to know which of the ~43 save sites and 4 render functions to touch.

## Recommendation: no framework yet, but restructure before the Vault

A framework wouldn't fix the real problem, which is that **saving is scattered**. The Vault needs "encrypt on every save" and Sync needs "mark changed on every save". With 43 save sites, both would have to be added 43 times. Preact would mean a build step or a rewrite, and it would lose the "one file, opens anywhere, works offline" simplicity. None of the three signs is strong enough yet to justify that.

**Instead, three focused steps, each one Epic-sized story:**

1. **One place to change items (a tiny store).**
   `updateItem(item, changes)` → saves, then notifies whoever is listening, and the lists and editor re-render themselves. All 43 save sites move to it. This is also exactly where the Vault's encryption and Sync's "changed" flag will plug in, once, instead of 43 times.
2. **Split the editor into sections.**
   Break `openDetail()` into parts that redraw on their own (header, content, tags, auto-delete, run history), the way the auto-delete row and run history already work. That ends the "re-render the whole pane" bugs.
3. **Keep the browser tests.**
   This round was checked with ~20 Playwright scripts (migration, trash, undo, offline, placeholders, code colors…). Adding them to the repo, with a GitHub Action that runs them on every push, gives a safety net before touching encryption.

Optional, and only if the file keeps growing: split `index.html` into a few plain JavaScript modules (`db.js`, `store.js`, `editor.js` …). Browsers load these without any build step.

**Check again at Sync (v2.0).** If state gets tangled between local, syncing and locked there, that's the moment to reconsider Preact, and the store from step 1 makes that switch much smaller.

## What's needed from you

Pick one:

- **A. No framework. Do the store, editor split and tests first** *(recommended)*, as a short "v1.5 build" before the Vault.
- **B. No framework, no restructure.** Go straight to the Vault and accept adding encryption at each save site.
- **C. Adopt Preact now.** Needs a build step. Largest change, and reintroduces risk to features that work today.

## Decision: A (done 25 Sep 2026)

All three steps are built, in this order: tests first, so they could catch anything the other two broke.

| Step | What changed | Result |
|---|---|---|
| **Tests** | 37 Playwright tests in `tests/`, run by `.github/workflows/tests.yml` on every push. Run locally with `npm install` then `npm test`. | Covers notes, trash/undo, commands and placeholders, paste detection and clean-up, auto-delete, migration, export/import (incl. 120 items), Ctrl+K, the photo viewer, phone swipe/long-press/drawer/back button, offline and share target. |
| **Store** | `saveItem`, `saveItems` and `deleteItems` are now the only code that writes items. They keep `cache` in step and announce the change; the sidebar and list redraw themselves once per frame if the caller didn't. | 51 separate `put()` calls → one store. Bulk actions, the expiry sweep and import write in one transaction. **This is where Vault encryption and Sync's "changed" flag plug in.** |
| **Editor split** | `openDetail()` (540 lines) → a 41-line coordinator plus four sections: header (130), fields (160), properties (111), footer (131). | Pin, favorite, unread, archive, color and tags redraw only their own section. Fixed a real bug: pressing one of them within 0.7 s of typing made the typed text disappear. 6 new tests fail on the old editor and pass now. |

Next: the Vault.
