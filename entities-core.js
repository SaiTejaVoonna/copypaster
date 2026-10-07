// CopyPaster entities: reusable people, places and things. The data rules,
// with no screen code. window.CPEntities
//
// An entity has one identity (its id). Groups show a *page* for it: an item
// in group.mainTags whose `entity` points here. Renaming the entity renames
// every page; a page never copies the entity's details.
//
// Types say what kind of entity it is and which fields it has. Built-in types
// live here; people can add fields to a type or make their own types, which
// are stored as data (see mergeTypes).
(function () {
  "use strict";

  const ENTITY_SCHEMA = 1;
  const KINDS = ["person", "place", "thing"];
  // One field engine for groups and entities. Amount and rating stay built-in group fields.
  const FIELD_TYPES = ["text", "number", "date", "expiry", "phone", "place", "person"];
  const FIELD_TYPE_LABELS = { text: "Text", number: "Number", date: "Date", expiry: "Expiry date (reminds you)", phone: "Phone", place: "Place", person: "Person" };
  const MAX = { name: 60, aka: 6, note: 300, fields: 16, value: 200, typeName: 24 };

  const f = (id, name, type, unit) => ({ id, name, type, unit: unit || "" });
  const BUILTIN_TYPES = [
    { key: "doctor", name: "Doctor", kind: "person", icon: "cross", fields: [f("specialty", "Specialty", "text"), f("clinic", "Clinic", "place"), f("phone", "Phone", "phone"), f("reg", "Registration no.", "text")] },
    { key: "person", name: "Person", kind: "person", icon: "user", fields: [f("relation", "Relation", "text"), f("phone", "Phone", "phone")] },
    { key: "restaurant", name: "Restaurant", kind: "place", icon: "utensils", fields: [f("cuisine", "Cuisine", "text"), f("area", "Area", "text"), f("price", "Price", "text")] },
    { key: "clinic", name: "Clinic", kind: "place", icon: "cross", fields: [f("area", "Area", "text"), f("phone", "Phone", "phone")] },
    { key: "place", name: "Place", kind: "place", icon: "map-pin", fields: [f("area", "Area", "text"), f("address", "Address", "text"), f("phone", "Phone", "phone")] },
    { key: "vehicle", name: "Vehicle", kind: "thing", icon: "bike", fields: [f("model", "Model", "text"), f("reg", "Registration", "text"), f("insurance", "Insurance expiry", "expiry"), f("service", "Next service", "expiry")] },
    { key: "title", name: "Title", kind: "thing", icon: "film", fields: [f("format", "Format", "text"), f("episodes", "Episodes", "number"), f("year", "Year", "number")] },
    { key: "thing", name: "Thing", kind: "thing", icon: "layers", fields: [] }
  ];

  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2));
  const clamp = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);
  const fold = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/^(dr|doctor|prof|mr|mrs|ms)\.?\s+/, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

  function normalizeField(x) {
    return { id: clamp(x && x.id, 40) || uid(), name: clamp(x && x.name, MAX.typeName) || "Field",
      type: FIELD_TYPES.includes(x && x.type) ? x.type : "text", unit: clamp(x && x.unit, 8) };
  }

  // Built-in types, plus what people added: extra fields on a built-in type, and their own types.
  // stored: { extra: { typeKey: [fields] }, custom: [types] }
  function mergeTypes(stored) {
    const st = stored || {};
    const extra = st.extra && typeof st.extra === "object" ? st.extra : {};
    const out = BUILTIN_TYPES.map((t) => ({ ...t, builtin: true, fields: [...t.fields, ...(Array.isArray(extra[t.key]) ? extra[t.key] : []).map(normalizeField)] }));
    for (const c of Array.isArray(st.custom) ? st.custom : []) {
      if (!c || !c.key || out.some((t) => t.key === c.key)) continue;
      out.push({ key: clamp(c.key, 40), name: clamp(c.name, MAX.typeName) || "Type", kind: KINDS.includes(c.kind) ? c.kind : "thing",
        icon: clamp(c.icon, 24) || "layers", builtin: false, fields: (Array.isArray(c.fields) ? c.fields : []).slice(0, MAX.fields).map(normalizeField) });
    }
    return out;
  }
  const typeOf = (types, key) => types.find((t) => t.key === key) || types.find((t) => t.key === "thing");

  // Which type a group's "main" word means, for groups made before 2.6.
  function typeForLabel(label, groupName) {
    const l = String(label || "").trim().toLowerCase();
    const gname = String(groupName || "").toLowerCase();
    if (!l) return null;
    if (/doctor|dentist|physician|surgeon/.test(l)) return "doctor";
    if (/^(person|people|friend|contact|teacher|mechanic)/.test(l)) return "person";
    if (/clinic|hospital|lab/.test(l)) return "clinic";
    if (/restaurant|cafe|café|place|venue|shop|store/.test(l)) return /food|eat|restaurant|cafe/.test(gname) || /restaurant|cafe|café/.test(l) ? "restaurant" : "place";
    if (/title|show|anime|movie|film|book|series|game/.test(l)) return "title";
    if (/bike|car|vehicle|scooter/.test(l)) return "vehicle";
    return "thing";
  }

  function normalizeEntity(e, types) {
    const now = Date.now();
    const type = typeOf(types, e && e.type);
    const fields = {};
    const src = e && e.fields && typeof e.fields === "object" ? e.fields : {};
    for (const [k, v] of Object.entries(src)) {
      if (v == null || v === "") continue;
      fields[clamp(k, 40)] = typeof v === "number" && Number.isFinite(v) ? v : clamp(v, MAX.value);
    }
    return {
      id: (e && e.id) || uid(),
      schema: ENTITY_SCHEMA,
      kind: type.kind,
      type: type.key,
      name: clamp(e && e.name, MAX.name) || "Untitled",
      aka: (Array.isArray(e && e.aka) ? e.aka : []).map((a) => clamp(a, MAX.name)).filter(Boolean).slice(0, MAX.aka),
      fields,
      extra: (Array.isArray(e && e.extra) ? e.extra : []).slice(0, MAX.fields).map(normalizeField),
      note: clamp(e && e.note, MAX.note),
      photo: typeof (e && e.photo) === "string" && e.photo.startsWith("data:image/") && !e.photo.startsWith("data:image/svg") ? e.photo : null,
      reminded: e && e.reminded && typeof e.reminded === "object" ? { ...e.reminded } : {},
      createdAt: (e && e.createdAt) || now,
      updatedAt: (e && e.updatedAt) || now
    };
  }

  // All fields an entity shows: its type's, then its own extra ones.
  const fieldsOf = (ent, types) => [...typeOf(types, ent.type).fields, ...ent.extra.filter((x) => !typeOf(types, ent.type).fields.some((y) => y.id === x.id))];

  // A value as text. Links to other entities show their names.
  function showValue(field, v, byId) {
    if (v == null || v === "") return "";
    if (field.type === "place" || field.type === "person") { const o = byId(v); return o ? o.name : ""; }
    if (field.type === "date" || field.type === "expiry") {
      const t = new Date(String(v) + "T00:00").getTime();
      return Number.isFinite(t) ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : String(v);
    }
    return String(v) + (field.unit ? " " + field.unit : "");
  }

  // One line under the name: the first two text-like details ("Dermatology · Skin Clinic").
  function summary(ent, types, byId) {
    const parts = [];
    for (const fd of fieldsOf(ent, types)) {
      if (parts.length >= 2) break;
      if (fd.type === "phone" || fd.type === "date" || fd.type === "expiry" || fd.type === "number") continue;
      const s = showValue(fd, ent.fields[fd.id], byId);
      if (s) parts.push(s);
    }
    if (!parts.length && ent.note) parts.push(ent.note.split("\n")[0].slice(0, 60));
    return parts.join(" · ");
  }

  // Names that look like this one (for "Did you mean…?"). Best first.
  function similar(name, list, opts = {}) {
    const q = fold(name);
    if (!q) return [];
    const scored = [];
    for (const ent of list) {
      if (opts.kind && ent.kind !== opts.kind) continue;
      const names = [ent.name, ...ent.aka].map(fold).filter(Boolean);
      let best = 0;
      for (const n of names) {
        if (n === q) best = Math.max(best, 100);
        else if (n.startsWith(q) || q.startsWith(n)) best = Math.max(best, 80);
        else if (n.includes(q) || q.includes(n)) best = Math.max(best, 60);
        else {
          const a = new Set(n.split(" ")), b = q.split(" ");
          const shared = b.filter((w) => w.length > 2 && a.has(w)).length;
          if (shared) best = Math.max(best, 40 + 10 * shared);
        }
      }
      if (best) scored.push([best, ent]);
    }
    return scored.sort((x, y) => y[0] - x[0]).map(([, e]) => e);
  }

  // Dates in expiry fields that are due within `days` (or already passed).
  function dueDates(list, types, now = Date.now(), days = 30) {
    const out = [];
    for (const ent of list) {
      for (const fd of fieldsOf(ent, types)) {
        if (fd.type !== "expiry") continue;
        const v = ent.fields[fd.id];
        if (!v) continue;
        const at = new Date(String(v) + "T09:00").getTime();
        if (!Number.isFinite(at)) continue;
        if (at - now <= days * 86400000) out.push({ entity: ent, field: fd, at, due: at <= now });
      }
    }
    return out.sort((a, b) => a.at - b.at);
  }

  // ---------- Moving 2.5 "main tags" to entities ----------
  // groups: normalized groups. Returns { entities, links: [{ g, tagId, entity }], review: [...] }.
  // Same name and kind in different groups → one entity (that's the point).
  // The same name twice in one group stays two entities and goes to Review.
  function planMigration(groups, existing, types) {
    const entities = existing.slice();
    const links = [];
    const review = [];
    const looksLikePerson = (s) => /^(dr|doctor)\.?\s/i.test(String(s).trim());
    for (const g of groups) {
      if (!g.mainLabel) continue;
      const typeKey = g.mainType || typeForLabel(g.mainLabel, g.name);
      const type = typeOf(types, typeKey);
      const seen = new Map();
      for (const t of g.mainTags) {
        if (t.entity && entities.some((x) => x.id === t.entity)) continue;
        const name = clamp(t.name, MAX.name) || "Untitled";
        const info = clamp(t.info, MAX.note);
        let ent = null;
        const dupInGroup = seen.has(fold(name));
        if (!dupInGroup) ent = entities.find((x) => x.kind === type.kind && fold(x.name) === fold(name) && x._from !== g.id) || null;
        if (!ent) {
          const fields = {};
          let note = info;
          // A doctor whose details are a specialty: "Dr T Rao" + "Surgical Gastroenterology".
          if (type.key === "doctor" && info && looksLikePerson(name) && !/\bdr\.?\s/i.test(info)) { fields.specialty = info.split("·")[0].trim(); note = info.split("·").slice(1).join("·").trim(); }
          ent = normalizeEntity({ name, type: type.key, fields, note }, types);
          ent._from = g.id;
          entities.push(ent);
        }
        links.push({ g: g.id, tagId: t.id, entity: ent.id });
        // Worth a look: a "doctor" that's really a department, or the same name twice in one group.
        let suggest = null;
        if (type.key === "doctor" && !looksLikePerson(name) && info) {
          const person = info.split("·")[0].trim();
          if (person && /\p{L}/u.test(person)) suggest = { name: tidy(person), fields: { specialty: name }, note: info.split("·").slice(1).join("·").trim() };
        }
        if (suggest || dupInGroup) review.push({ entity: ent.id, group: g.id, was: { name, info }, reason: dupInGroup ? "same-name" : "department", suggest });
        if (dupInGroup) { const first = seen.get(fold(name)); if (!review.some((r) => r.entity === first)) review.push({ entity: first, group: g.id, was: { name, info: "" }, reason: "same-name", suggest: null }); }
        seen.set(fold(name), ent.id);
      }
    }
    entities.forEach((x) => { delete x._from; });
    return { entities, links, review };
  }
  // "madhavi pudi" → "Madhavi Pudi"; text with capitals stays as typed.
  function tidy(raw) {
    const s = String(raw || "").trim().replace(/\s+/g, " ");
    if (!s || s !== s.toLowerCase()) return s;
    return s.replace(/(^|[\s(/-])(\p{L})/gu, (m, pre, ch) => pre + ch.toUpperCase());
  }

  window.CPEntities = { ENTITY_SCHEMA, KINDS, FIELD_TYPES, FIELD_TYPE_LABELS, BUILTIN_TYPES, MAX, uid, mergeTypes, typeOf, typeForLabel, normalizeEntity, normalizeField,
    fieldsOf, showValue, summary, similar, dueDates, planMigration, tidy, fold };
})();
