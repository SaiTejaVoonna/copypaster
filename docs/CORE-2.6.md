# CopyPaster 2.6: the foundation

*Phase 1 of the plan in [PLAN.md](PLAN.md). The rules behind it are in [ENGINE.md](ENGINE.md). Everything still works offline and keeps data on the device.*

## Files

| File | What |
|---|---|
| `entities-core.js` | People, places and things: types, fields, did-you-mean matching, due dates, moving 2.5 main tags over. `window.CPEntities`. No screen code. |
| `snap.js` | Snap: reads the picked photo into an original plus a display copy, capture details, and a separate location lookup. `window.CPSnap`. |

`groups.js` adds pages, the person/place editor, merge, review and contextual Snap. `index.html` adds the dock picker, Spaces wording (for groups), the Captured filter, global Snap and the Reminders dates. Storage moves to IndexedDB version 6 with a new `entities` store.

## Fixes from phone testing

- **Filter sheet:** every section is laid out the same way, and Clear all / Show stay pinned at the bottom.
- **Custom dates on phones:** a "Custom dates" chip opens From and To.
- **Hiding:** tap a chip once to show only those, twice to hide them, three times to clear it. Search understands `-#tag`, `-group:`, `-type:`, `-is:` and `-in:notes`. A plain `-word` stays text, so `ls -la` still works. On computers, the Group and Tag menus have a hide button on each row.
- **Dock:** Settings → Appearance → Dock on phones. You pick three tabs (Inbox, Spaces, Timeline, Search, Favorites, Reminders, Unread, Notes). New stays in the middle and More at the end. Timeline opens without the keyboard; Search opens with it.
- **Space message bar:**
  - a Tags row (recent tags, plus Tag to find or create one);
  - rating stars on their own row;
  - a photo with no text is titled "Photo";
  - new names typed in small letters get capitals ("roadside bbq" → "Roadside Bbq").

## Profiles and Spaces

Groups are now shown as **Spaces** (Health, Food, Trips…), and Profiles stay **Profiles** (Personal, Work, Family). Only the wording changed; the stored data is the same. Search takes `space:food`, and `group:food` still works.

Starting templates are now **Health** (was Hospital), Food, **Trips** (new), **Vehicles** (was Bike, now with a page per vehicle) and **Watchlist** (was Movies & Anime). Spaces you already made keep their names.

## People, places and things

- **Entities.** A group's "main tag" choices are now entities with a **type**: Doctor, Person, Restaurant, Clinic, Place, Vehicle, Title or Thing. The type decides which details an entity has.
  - A Doctor has Specialty, Clinic (a place), Phone and Registration no.
  - A Vehicle has Model, Registration, Insurance expiry and Next service.
- **Pages.** Each group shows the entities it's about as **circles** at the top. Tapping a circle opens that entity's page in this group:
  - its type and one-line summary, and its phone number to copy;
  - stats worked out from its entries (visits or entries, total spent, average rating, last and first date, upcoming expiry dates);
  - **Also in** links to the same entity's page in other groups.
- **One identity.** The same doctor in Hospital and Insurance is one entity. Renaming them once renames them everywhere.
- **Adding:** **+ New** asks only for a name and a type. As you type, **Did you mean** shows people and places you already have, in any group. Picking one adds its page here without making a copy.
- **Editing** an entity covers:
  - name, type and the type's details;
  - **Add detail**, for this one only or for all of its type;
  - other spellings (also known as) and notes;
  - **Merge into…** for duplicates. Entries, groups, details and the other spelling move over, then the duplicate is deleted.
  - **Delete**, which removes it from its groups and leaves their entries in place.
- **Edit group → About** sets what the people or things are called and their type. It lists each page with Edit and Remove from this group.
- **One field engine.** Group fields gain **Expiry date**, **Phone**, **Place** and **Person**. Place and Person link to entities.
- **Expiry dates** from entities and entries show at the top of **Reminders** ("Dates from your groups", within 30 days). Each one pops up once when it's due.
- **Moving 2.5 data.** On first open, every 2.5 main tag becomes an entity of the group's type.
  - The same name in different groups becomes one entity.
  - A doctor whose details are a specialty gets it as the Specialty field.
  - Names that look mixed up go to **Check these names**: a department used as a doctor, or the same name twice in one group. You can use the suggested name, merge, edit, or keep it as is.

## Snap

- **Capture, save, done.** Nothing is asked before the photo is saved, and saving works offline.
- **Snap from the + menu** saves to the Inbox at once, under the **Captured** filter. Writing on it, or giving it a folder or a tag, counts as sorting it out.
- **Snap from inside a group, page or sub-chat** (the message bar's + → Snap) saves straight there. For example: Food → Nimrah Cafe → Dishes.
- **Snap another** is offered right after each save.
- **Each snap keeps:**
  - the original file as it was picked (up to 15 MB), with **Open original**;
  - the time, where it came from (camera or library) and the file name;
  - if allowed, the location with its accuracy. Location is looked up after saving and never delays it. Turn it off in Settings → Your data → Location on snaps.
- **From Inbox** (the message bar's + menu) moves an earlier snap into the open group, page and sub-chat, with its capture details. It's moved, never copied.
- Not in 2.6: reading text from photos, AI, and automatic matching. Those come in 2.7 at the earliest.

## Tests

`tests/v26.spec.js` (desktop) and `tests/v26.phone.spec.js` (phone) cover:
- minus words and three-state chips;
- the group message bar's tags and rating;
- the Filter sheet layout and custom dates;
- the dock picker;
- moving 2.5 data, with Review and one person in two groups;
- did-you-mean and merge;
- add detail for all of a type, and expiry dates in Reminders;
- Snap to Inbox with location and the original;
- Snap inside a group, and From Inbox.
