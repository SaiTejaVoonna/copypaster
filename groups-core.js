// CopyPaster Groups: the data rules, with no screen code.
//
// A Group (shown as a Space) is a timeline for one topic (Health, Food, Trips...). It is plain
// data: sub-chats, main tags, which fields are on, and how cards group.
// Entries live in their own store, separate from notes. Everything shown on
// screen (counts, totals, cards, month headings) is computed here from the
// entries, never stored, so it can't drift out of date.
//
// Loaded before the main app script; exposes window.CPGroupsCore.
(function () {
  "use strict";

  const DAY = 86400000;
  const LATE_JOIN_DAYS = 7;
  const GROUP_SCHEMA = 1;
  const ENTRY_SCHEMA = 1;

  // Icons a group or sub-chat may use. Imported templates are checked against this list.
  const ICONS = [
    "layers", "cross", "pill", "clipboard", "flask", "receipt", "cup", "utensils", "book", "heart",
    "film", "play", "check", "bookmark", "quote", "bike", "car", "fuel", "wrench", "cog", "route",
    "map-pin", "plane", "home", "briefcase", "paw", "dumbbell", "gift", "cart", "camera", "music",
    "baby", "school", "wallet", "star", "leaf", "note", "image", "link", "calendar"
  ];
  const COLORS = ["#ef4444", "#f97316", "#f5b544", "#22c55e", "#14b8a6", "#4c8dff", "#6366f1", "#8b5cf6", "#ec4899", "#64748b"];
  const CURRENCIES = [
    { code: "INR", symbol: "₹" }, { code: "USD", symbol: "$" }, { code: "EUR", symbol: "€" },
    { code: "GBP", symbol: "£" }, { code: "AED", symbol: "AED" }, { code: "JPY", symbol: "¥" },
    { code: "AUD", symbol: "A$" }, { code: "CAD", symbol: "C$" }, { code: "SGD", symbol: "S$" }
  ];
  const FIELD_TYPES = ["number", "text", "date", "expiry", "phone", "place", "person"];
  const FIELD_STATS = ["none", "sum", "latest"];
  const CARD_MODES = ["none", "day", "title"];
  const MAX = { name: 40, desc: 120, subs: 12, custom: 8, unit: 8, tags: 60, label: 24 };

  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2));
  const clampStr = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);
  const isColor = (c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
  const currencyOk = (c) => CURRENCIES.some((x) => x.code === c);

  // ---------- Templates (data, not code) ----------
  const sub = (name, label, icon, color, extra) => ({ name, label, icon, color, ...(extra || {}) });
  // A shorter way to write the extra templates.
  const T = (key, name, desc, icon, color, subs, o) => ({ key, name, desc, icon, color, subs, mainLabel: o.mainLabel || "", mainType: o.mainType || "",
    fields: { amount: { on: o.amount !== false, currency: "INR" }, rating: !!o.rating, custom: o.custom || [] }, cards: "none", cardWord: "" });
  const TEMPLATES = [
    { key: "blank", name: "Blank", desc: "Just a timeline. Add sub-chats and fields whenever you want.", icon: "layers", color: "#64748b",
      subs: [], mainLabel: "", fields: { amount: { on: true, currency: "INR" }, rating: false, custom: [] }, cards: "none", cardWord: "" },
    { key: "hospital", name: "Health", desc: "Doctors, prescriptions, lab reports, medicines and bills", icon: "cross", color: "#ef4444",
      subs: [sub("Prescriptions", "Prescription", "clipboard", "#22c55e"), sub("Lab Reports", "Lab Report", "flask", "#8b5cf6", { late: true }),
        sub("Medicines", "Medicine", "pill", "#ec4899", { late: true }), sub("Bills", "Bill", "receipt", "#f5b544", { late: true })],
      mainLabel: "Doctor", mainType: "doctor", fields: { amount: { on: true, currency: "INR" }, rating: false, custom: [] }, cards: "day", cardWord: "Visit" },
    { key: "food", name: "Food", desc: "Places I ate, bills, recipes and places to try", icon: "cup", color: "#f97316",
      subs: [sub("Dishes", "Dish", "utensils", "#14b8a6"), sub("Bills", "Bill", "receipt", "#f5b544"),
        sub("Recipes", "Recipe", "book", "#8b5cf6", { noTag: true }), sub("Wishlist", "Wishlist", "heart", "#ec4899")],
      mainLabel: "Place", mainType: "restaurant", fields: { amount: { on: true, currency: "INR" }, rating: true, custom: [] }, cards: "day", cardWord: "Outing" },
    { key: "movies", name: "Watchlist", desc: "Movies, shows and anime: what I watch, my thoughts, what's next", icon: "film", color: "#8b5cf6",
      subs: [sub("Watching", "Watching", "play", "#4c8dff"), sub("Watched", "Watched", "check", "#22c55e"),
        sub("To watch", "To watch", "bookmark", "#f5b544"), sub("Thoughts", "Thought", "quote", "#8b5cf6", { noStatus: true })],
      mainLabel: "Title", mainType: "title", fields: { amount: { on: false, currency: "INR" }, rating: true, custom: [{ name: "Episode", type: "number", unit: "", stat: "none" }] },
      cards: "title", cardWord: "Title" },
    { key: "bike", name: "Vehicles", desc: "Every bike, car or scooter with its own page: fuel, mileage, service, papers", icon: "bike", color: "#14b8a6",
      subs: [sub("Fuel", "Fill-up", "fuel", "#f97316"), sub("Service", "Service", "wrench", "#4c8dff"), sub("Spare parts", "Spare part", "cog", "#8b5cf6"),
        sub("Insurance & papers", "Paper", "clipboard", "#22c55e", { noStatus: true }), sub("Tolls & parking", "Toll", "receipt", "#f5b544"), sub("Photos", "Photo", "camera", "#ec4899")],
      mainLabel: "Vehicle", mainType: "vehicle", fields: { amount: { on: true, currency: "INR" }, rating: false, custom: [
        { name: "Odometer", type: "number", unit: "km", stat: "latest" }, { name: "Litres", type: "number", unit: "L", stat: "sum" }] },
      cards: "none", cardWord: "" },
    { key: "trips", name: "Trips", desc: "Each trip: tickets, stays, meals, spends and photos", icon: "plane", color: "#0ea5e9",
      subs: [sub("Tickets", "Ticket", "plane", "#4c8dff"), sub("Stays", "Stay", "home", "#8b5cf6"), sub("Meals", "Meal", "utensils", "#f97316"),
        sub("Spends", "Spend", "wallet", "#f5b544"), sub("Photos", "Photo", "camera", "#ec4899")],
      mainLabel: "Trip", mainType: "place", fields: { amount: { on: true, currency: "INR" }, rating: false, custom: [] }, cards: "day", cardWord: "Day" },
    T("pets", "Pets", "Vet visits, supplies, grooming and vaccines for each pet", "paw", "#a16207",
      [sub("Vet visits", "Vet visit", "cross", "#ef4444"), sub("Vaccines", "Vaccine", "pill", "#ec4899", { late: true }), sub("Supplies", "Supply", "cart", "#f97316"),
        sub("Grooming", "Grooming", "heart", "#8b5cf6"), sub("Photos", "Photo", "camera", "#4c8dff")],
      { mainLabel: "Pet", mainType: "thing", custom: [{ name: "Weight", type: "number", unit: "kg", stat: "latest" }] }),
    T("home", "Home", "Bills, repairs, groceries and things around the house", "home", "#22c55e",
      [sub("Bills", "Bill", "receipt", "#f5b544"), sub("Repairs", "Repair", "wrench", "#4c8dff"), sub("Groceries", "Grocery run", "cart", "#22c55e"), sub("Appliances", "Appliance", "cog", "#64748b")],
      { mainLabel: "", custom: [] }),
    T("bills", "Bills & subscriptions", "Electricity, internet, phone, rent and subscriptions, with due dates", "wallet", "#f5b544",
      [sub("Paid", "Payment", "check", "#22c55e"), sub("Due", "Due bill", "calendar", "#ef4444"), sub("Receipts", "Receipt", "receipt", "#f5b544")],
      { mainLabel: "Provider", mainType: "thing", custom: [{ name: "Next due", type: "expiry", unit: "", stat: "none" }] }),
    T("shopping", "Shopping", "What I bought, want, returned, and warranties", "cart", "#ec4899",
      [sub("Bought", "Purchase", "cart", "#ec4899"), sub("Wishlist", "Wish", "heart", "#8b5cf6"), sub("Returns", "Return", "route", "#f97316"), sub("Warranty", "Warranty", "clipboard", "#14b8a6", { noTag: true })],
      { mainLabel: "Store", mainType: "place", rating: true, custom: [{ name: "Warranty till", type: "expiry", unit: "", stat: "none" }] }),
    T("money", "Money", "Spends, income, investments and loans", "wallet", "#14b8a6",
      [sub("Spends", "Spend", "cart", "#ef4444"), sub("Income", "Income", "wallet", "#22c55e"), sub("Investments", "Investment", "star", "#6366f1"), sub("Loans", "Loan", "receipt", "#f97316")],
      { mainLabel: "", custom: [] }),
    T("documents", "Documents & IDs", "IDs, certificates, insurance and warranties, with expiry reminders", "clipboard", "#6366f1",
      [sub("IDs", "ID", "clipboard", "#6366f1"), sub("Certificates", "Certificate", "star", "#f5b544"), sub("Insurance", "Policy", "heart", "#ef4444"), sub("Warranties", "Warranty", "check", "#22c55e")],
      { mainLabel: "Person", mainType: "person", amount: false, custom: [{ name: "Expires", type: "expiry", unit: "", stat: "none" }, { name: "Number", type: "text", unit: "", stat: "none" }] }),
    T("fitness", "Fitness", "Gym, workouts, runs, weight and diet", "dumbbell", "#ef4444",
      [sub("Workouts", "Workout", "dumbbell", "#ef4444"), sub("Runs & walks", "Run", "route", "#22c55e"), sub("Weight", "Weigh-in", "check", "#4c8dff"), sub("Diet", "Meal", "utensils", "#f97316")],
      { mainLabel: "", amount: false, custom: [{ name: "Minutes", type: "number", unit: "min", stat: "sum" }, { name: "Distance", type: "number", unit: "km", stat: "sum" }, { name: "Weight", type: "number", unit: "kg", stat: "latest" }] }),
    T("work", "Work", "Meetings, tasks, expenses and ideas", "briefcase", "#64748b",
      [sub("Meetings", "Meeting", "calendar", "#4c8dff"), sub("Tasks", "Task", "check", "#22c55e"), sub("Expenses", "Expense", "receipt", "#f5b544"), sub("Ideas", "Idea", "quote", "#8b5cf6", { noStatus: true })],
      { mainLabel: "Person", mainType: "person", custom: [] }),
    T("study", "Study", "Classes, notes, exams and fees for each course", "school", "#4c8dff",
      [sub("Classes", "Class", "school", "#4c8dff"), sub("Notes", "Note", "note", "#f5b544", { noStatus: true }), sub("Exams", "Exam", "calendar", "#ef4444"), sub("Fees", "Fee", "receipt", "#22c55e")],
      { mainLabel: "Course", mainType: "thing", custom: [{ name: "Marks", type: "number", unit: "", stat: "latest" }] }),
    T("kids", "Kids", "Doctor visits, school, milestones and photos for each child", "baby", "#f97316",
      [sub("Doctor visits", "Doctor visit", "cross", "#ef4444"), sub("School", "School", "school", "#4c8dff"), sub("Milestones", "Milestone", "star", "#f5b544", { noStatus: true }), sub("Photos", "Photo", "camera", "#ec4899")],
      { mainLabel: "Child", mainType: "person", custom: [{ name: "Height", type: "number", unit: "cm", stat: "latest" }, { name: "Weight", type: "number", unit: "kg", stat: "latest" }] }),
    T("books", "Books", "Reading, read, to read and favourite quotes", "book", "#8b5cf6",
      [sub("Reading", "Reading", "book", "#4c8dff"), sub("Read", "Read", "check", "#22c55e"), sub("To read", "To read", "bookmark", "#f5b544"), sub("Quotes", "Quote", "quote", "#8b5cf6", { noStatus: true })],
      { mainLabel: "Title", mainType: "title", amount: false, rating: true, custom: [{ name: "Pages", type: "number", unit: "", stat: "sum" }] }),
    T("events", "Events & gifts", "Birthdays, weddings and gifts given or received", "gift", "#ec4899",
      [sub("Birthdays", "Birthday", "gift", "#ec4899"), sub("Weddings & functions", "Function", "star", "#f5b544"), sub("Gifts given", "Gift given", "gift", "#22c55e"), sub("Gifts received", "Gift received", "heart", "#8b5cf6")],
      { mainLabel: "Person", mainType: "person", custom: [{ name: "Date", type: "date", unit: "", stat: "none" }] }),
    T("gadgets", "Gadgets", "Phones, laptops and devices: bills, warranties and repairs", "cog", "#0ea5e9",
      [sub("Bills", "Bill", "receipt", "#f5b544"), sub("Warranty", "Warranty", "clipboard", "#22c55e"), sub("Repairs", "Repair", "wrench", "#ef4444"), sub("Accessories", "Accessory", "cart", "#8b5cf6")],
      { mainLabel: "Device", mainType: "thing", custom: [{ name: "Warranty till", type: "expiry", unit: "", stat: "none" }] }),
    T("garden", "Plants & garden", "Plants, watering, fertiliser and photos", "leaf", "#16a34a",
      [sub("Plants", "Plant", "leaf", "#16a34a"), sub("Watering", "Watering", "check", "#4c8dff"), sub("Fertiliser", "Feed", "flask", "#a16207"), sub("Photos", "Photo", "camera", "#ec4899")],
      { mainLabel: "Plant", mainType: "thing", amount: false, custom: [] }),
    // Health
    T("medicines", "Medicines & refills", "Daily medicines, when to refill, and pharmacy bills", "pill", "#ec4899",
      [sub("Daily", "Dose", "pill", "#ec4899", { noStatus: true }), sub("Refills", "Refill", "cart", "#22c55e"), sub("Pharmacy bills", "Bill", "receipt", "#f5b544")],
      { mainLabel: "Medicine", mainType: "thing", custom: [{ name: "Refill by", type: "expiry", unit: "", stat: "none" }, { name: "Tablets left", type: "number", unit: "", stat: "latest" }] }),
    T("dental", "Dental", "Checkups, treatments, X-rays and bills", "cross", "#0ea5e9",
      [sub("Checkups", "Checkup", "check", "#22c55e"), sub("Treatments", "Treatment", "cross", "#ef4444"), sub("X-rays", "X-ray", "image", "#8b5cf6"), sub("Bills", "Bill", "receipt", "#f5b544")],
      { mainLabel: "Dentist", mainType: "doctor", custom: [{ name: "Next checkup", type: "expiry", unit: "", stat: "none" }] }),
    T("eyes", "Eye care", "Eye tests, glasses, lenses and bills", "star", "#14b8a6",
      [sub("Eye tests", "Eye test", "check", "#14b8a6"), sub("Glasses & lenses", "Pair", "star", "#8b5cf6"), sub("Bills", "Bill", "receipt", "#f5b544")],
      { mainLabel: "Clinic", mainType: "clinic", custom: [{ name: "Left eye", type: "text", unit: "", stat: "none" }, { name: "Right eye", type: "text", unit: "", stat: "none" }, { name: "Next test", type: "expiry", unit: "", stat: "none" }] }),
    T("cycle", "Period & cycle", "Periods, symptoms and moods, kept private on your phone", "heart", "#db2777",
      [sub("Periods", "Period", "calendar", "#db2777"), sub("Symptoms", "Symptom", "pill", "#f97316"), sub("Moods", "Mood", "heart", "#8b5cf6", { noStatus: true })],
      { mainLabel: "", amount: false, custom: [{ name: "Cycle day", type: "number", unit: "", stat: "latest" }] }),
    T("therapy", "Therapy & wellbeing", "Sessions, journal and goals", "heart", "#8b5cf6",
      [sub("Sessions", "Session", "calendar", "#8b5cf6"), sub("Journal", "Entry", "quote", "#f5b544", { noStatus: true }), sub("Goals", "Goal", "star", "#22c55e")],
      { mainLabel: "Therapist", mainType: "person", custom: [] }),
    T("claims", "Insurance claims", "Policies, claims, papers sent and payouts", "clipboard", "#ef4444",
      [sub("Claims", "Claim", "clipboard", "#ef4444"), sub("Papers sent", "Paper", "clipboard", "#4c8dff"), sub("Payouts", "Payout", "wallet", "#22c55e")],
      { mainLabel: "Policy", mainType: "thing", custom: [{ name: "Claim number", type: "text", unit: "", stat: "none" }, { name: "Policy ends", type: "expiry", unit: "", stat: "none" }] }),
    // Money
    T("loans", "Loans & EMIs", "EMIs paid, statements and what's left", "wallet", "#f97316",
      [sub("EMIs paid", "EMI", "check", "#22c55e"), sub("Statements", "Statement", "receipt", "#f5b544"), sub("Papers", "Paper", "clipboard", "#6366f1")],
      { mainLabel: "Loan", mainType: "thing", custom: [{ name: "Next EMI", type: "expiry", unit: "", stat: "none" }, { name: "Left to pay", type: "number", unit: "", stat: "latest" }] }),
    T("tax", "Tax", "Proofs, returns filed, notices and receipts", "receipt", "#64748b",
      [sub("Proofs", "Proof", "clipboard", "#6366f1"), sub("Returns filed", "Return", "check", "#22c55e"), sub("Notices", "Notice", "bookmark", "#ef4444"), sub("Receipts", "Receipt", "receipt", "#f5b544")],
      { mainLabel: "Year", mainType: "thing", custom: [] }),
    T("cards", "Credit cards", "Statements, payments, rewards and disputes", "wallet", "#6366f1",
      [sub("Statements", "Statement", "receipt", "#f5b544"), sub("Payments", "Payment", "check", "#22c55e"), sub("Rewards", "Reward", "gift", "#ec4899"), sub("Disputes", "Dispute", "bookmark", "#ef4444")],
      { mainLabel: "Card", mainType: "thing", custom: [{ name: "Due date", type: "expiry", unit: "", stat: "none" }] }),
    // Home & family
    T("rent", "Rent & landlord", "Rent paid, agreement, deposit and repairs", "home", "#16a34a",
      [sub("Rent paid", "Rent", "check", "#22c55e"), sub("Agreement", "Paper", "clipboard", "#6366f1", { noTag: true }), sub("Repairs", "Repair", "wrench", "#4c8dff"), sub("Deposit", "Deposit", "wallet", "#f5b544")],
      { mainLabel: "House", mainType: "place", custom: [{ name: "Agreement ends", type: "expiry", unit: "", stat: "none" }] }),
    T("helpers", "House help & services", "Maid, cook, driver, plumber: payments and visits", "wrench", "#a16207",
      [sub("Payments", "Payment", "wallet", "#22c55e"), sub("Visits", "Visit", "calendar", "#4c8dff"), sub("Notes", "Note", "note", "#f5b544", { noStatus: true })],
      { mainLabel: "Person", mainType: "person", custom: [{ name: "Phone", type: "phone", unit: "", stat: "none" }] }),
    T("elders", "Parents & elders", "Doctor visits, medicines, bills and papers for parents", "heart", "#ef4444",
      [sub("Doctor visits", "Doctor visit", "cross", "#ef4444"), sub("Medicines", "Medicine", "pill", "#ec4899"), sub("Bills", "Bill", "receipt", "#f5b544"), sub("Papers", "Paper", "clipboard", "#6366f1")],
      { mainLabel: "Person", mainType: "person", custom: [] }),
    T("wedding", "Wedding & big events", "Vendors, payments, guests and ideas", "gift", "#db2777",
      [sub("Vendors", "Vendor", "briefcase", "#4c8dff"), sub("Payments", "Payment", "wallet", "#22c55e"), sub("Guests", "Guest", "heart", "#ec4899"), sub("Ideas", "Idea", "image", "#8b5cf6", { noStatus: true })],
      { mainLabel: "Vendor", mainType: "person", custom: [{ name: "Phone", type: "phone", unit: "", stat: "none" }] }),
    // Travel & vehicles
    T("commute", "Daily commute", "Cabs, autos, metro, bus passes and fares", "route", "#14b8a6",
      [sub("Cabs & autos", "Ride", "car", "#f5b544"), sub("Metro & bus", "Ride", "route", "#14b8a6"), sub("Passes", "Pass", "clipboard", "#6366f1")],
      { mainLabel: "", custom: [] }),
    T("tickets", "Tickets & bookings", "Flights, trains, buses and hotel bookings", "plane", "#0ea5e9",
      [sub("Flights", "Flight", "plane", "#0ea5e9"), sub("Trains", "Train", "route", "#22c55e"), sub("Buses", "Bus", "route", "#f97316"), sub("Hotels", "Hotel", "home", "#8b5cf6")],
      { mainLabel: "", custom: [{ name: "PNR", type: "text", unit: "", stat: "none" }, { name: "Travel date", type: "date", unit: "", stat: "none" }] }),
    // Work & study
    T("jobs", "Job hunt", "Applied, interviews, offers and rejections", "briefcase", "#4c8dff",
      [sub("Applied", "Application", "bookmark", "#4c8dff"), sub("Interviews", "Interview", "calendar", "#f5b544"), sub("Offers", "Offer", "star", "#22c55e"), sub("Closed", "Closed", "check", "#64748b")],
      { mainLabel: "Company", mainType: "thing", amount: false, custom: [{ name: "Salary", type: "number", unit: "", stat: "none" }] }),
    T("clients", "Clients & invoices", "Invoices, payments, projects and notes per client", "briefcase", "#22c55e",
      [sub("Invoices", "Invoice", "receipt", "#f5b544"), sub("Payments", "Payment", "wallet", "#22c55e"), sub("Projects", "Project", "layers", "#4c8dff"), sub("Notes", "Note", "note", "#8b5cf6", { noStatus: true })],
      { mainLabel: "Client", mainType: "person", custom: [{ name: "Due by", type: "expiry", unit: "", stat: "none" }] }),
    T("certs", "Courses & certificates", "Online courses, certificates and when they run out", "school", "#f5b544",
      [sub("Courses", "Course", "school", "#4c8dff"), sub("Certificates", "Certificate", "star", "#f5b544"), sub("Exams", "Exam", "calendar", "#ef4444")],
      { mainLabel: "Course", mainType: "thing", custom: [{ name: "Valid till", type: "expiry", unit: "", stat: "none" }] }),
    // Hobbies
    T("gaming", "Video games", "Playing, finished, wishlist and clips, per game", "play", "#8b5cf6",
      [sub("Playing", "Playing", "play", "#4c8dff"), sub("Finished", "Finished", "check", "#22c55e"), sub("Wishlist", "Wish", "heart", "#ec4899"), sub("Clips", "Clip", "camera", "#f97316")],
      { mainLabel: "Game", mainType: "title", rating: true, custom: [{ name: "Hours", type: "number", unit: "h", stat: "sum" }] }),
    T("sports", "Sports & matches", "Cricket, football, badminton, running: matches, practice, scores and gear", "dumbbell", "#16a34a",
      [sub("Matches", "Match", "star", "#16a34a"), sub("Practice", "Session", "calendar", "#4c8dff"), sub("Scores & stats", "Score", "check", "#f5b544"),
        sub("Gear", "Gear", "cart", "#8b5cf6"), sub("Fees & turf", "Booking", "receipt", "#f97316")],
      { mainLabel: "Sport", mainType: "thing", custom: [{ name: "Result", type: "text", unit: "", stat: "none" }, { name: "Score", type: "text", unit: "", stat: "none" },
        { name: "Minutes played", type: "number", unit: "min", stat: "sum" }, { name: "Venue", type: "place", unit: "", stat: "none" }] }),
    T("boardgames", "Board & indoor games", "Chess, carrom, cards and board games: game nights, results, wishlist", "star", "#a16207",
      [sub("Game nights", "Game night", "calendar", "#a16207"), sub("Results", "Result", "check", "#22c55e"), sub("Rules & tips", "Tip", "book", "#4c8dff", { noStatus: true }),
        sub("Wishlist", "Wish", "heart", "#ec4899")],
      { mainLabel: "Game", mainType: "title", amount: false, rating: true, custom: [{ name: "Players", type: "number", unit: "", stat: "none" },
        { name: "Winner", type: "person", unit: "", stat: "none" }, { name: "Minutes", type: "number", unit: "min", stat: "sum" }] }),
    T("music", "Music & concerts", "Concerts, albums and playlists", "music", "#ec4899",
      [sub("Concerts", "Concert", "music", "#ec4899"), sub("Albums", "Album", "play", "#8b5cf6"), sub("Playlists", "Playlist", "bookmark", "#4c8dff")],
      { mainLabel: "Artist", mainType: "person", rating: true, custom: [] }),
    T("cooking", "Cooking & recipes", "Recipes, what I cooked, what to try, groceries", "utensils", "#f97316",
      [sub("Recipes", "Recipe", "book", "#8b5cf6", { noStatus: true }), sub("Cooked", "Cooked", "check", "#22c55e"), sub("To try", "To try", "bookmark", "#f5b544"), sub("Groceries", "Grocery list", "cart", "#14b8a6")],
      { mainLabel: "Dish", mainType: "thing", rating: true, custom: [{ name: "Serves", type: "number", unit: "", stat: "none" }] }),
    T("photography", "Photography", "Shoots, edits, gear and ideas", "camera", "#64748b",
      [sub("Shoots", "Shoot", "camera", "#4c8dff"), sub("Edits", "Edit", "image", "#8b5cf6"), sub("Gear", "Gear", "cog", "#64748b"), sub("Ideas", "Idea", "quote", "#f5b544", { noStatus: true })],
      { mainLabel: "Place", mainType: "place", custom: [] }),
    T("collections", "Collections", "Things you collect: owned, wanted, sold", "star", "#f5b544",
      [sub("Owned", "Owned", "check", "#22c55e"), sub("Wanted", "Wanted", "heart", "#ec4899"), sub("Sold", "Sold", "wallet", "#f97316")],
      { mainLabel: "Item", mainType: "thing", rating: true, custom: [] })
  ];

  // Sections for the template picker, in order. Anything not listed goes under "More".
  const TEMPLATE_SECTIONS = [
    ["Start", ["blank"]],
    ["Health", ["hospital", "medicines", "dental", "eyes", "fitness", "cycle", "therapy", "claims"]],
    ["Food", ["food", "cooking"]],
    ["Money", ["money", "bills", "cards", "loans", "tax", "shopping"]],
    ["Home & family", ["home", "kids", "elders", "pets", "rent", "helpers", "events", "wedding", "garden"]],
    ["Travel & vehicles", ["bike", "trips", "tickets", "commute"]],
    ["Work & study", ["work", "jobs", "clients", "study", "certs"]],
    ["Documents & gadgets", ["documents", "gadgets"]],
    ["Hobbies & games", ["movies", "books", "gaming", "sports", "boardgames", "music", "photography", "collections"]]
  ];
  function templateSections(list) {
    const placed = new Set();
    const out = TEMPLATE_SECTIONS.map(([name, keys]) => {
      const items = keys.map((k) => list.find((t) => t.key === k)).filter(Boolean);
      items.forEach((t) => placed.add(t));
      return { name, items };
    });
    const rest = list.filter((t) => !placed.has(t));
    if (rest.length) out.push({ name: "More", items: rest });
    return out.filter((x) => x.items.length);
  }

  // Builds a new group from a template (or a validated imported one).
  function groupFromTemplate(t, name) {
    const now = Date.now();
    return normalizeGroup({
      id: uid(), name: name || t.name, desc: t.desc || "", icon: t.icon, color: t.color, cover: null,
      subs: (t.subs || []).map((s) => ({ ...s, id: uid() })),
      mainLabel: t.mainLabel || "", mainType: t.mainType || "", mainTags: [],
      fields: { amount: { ...(t.fields && t.fields.amount) }, rating: !!(t.fields && t.fields.rating),
        custom: ((t.fields && t.fields.custom) || []).map((f) => ({ ...f, id: uid() })) },
      cards: t.cards, cardWord: t.cardWord || "",
      createdAt: now, updatedAt: now, order: now
    });
  }

  // Fills in anything missing and drops anything unknown or out of range.
  function normalizeGroup(g) {
    const fields = g.fields || {};
    const amount = fields.amount || {};
    const out = {
      id: g.id || uid(),
      schema: GROUP_SCHEMA,
      name: clampStr(g.name, MAX.name) || "Untitled space",
      desc: clampStr(g.desc, MAX.desc),
      icon: ICONS.includes(g.icon) ? g.icon : "layers",
      color: isColor(g.color) ? g.color : COLORS[9],
      cover: typeof g.cover === "string" && g.cover.startsWith("data:image/") && !g.cover.startsWith("data:image/svg") ? g.cover : null,
      subs: (Array.isArray(g.subs) ? g.subs : []).slice(0, MAX.subs).map((s) => ({
        id: s.id || uid(),
        name: clampStr(s.name, MAX.name) || "Untitled",
        label: clampStr(s.label || s.name, MAX.name) || "Entry",
        icon: ICONS.includes(s.icon) ? s.icon : "note",
        color: isColor(s.color) ? s.color : COLORS[5],
        late: !!s.late, noTag: !!s.noTag, noStatus: !!s.noStatus
      })),
      mainLabel: clampStr(g.mainLabel, MAX.label),
      // Each main tag is this group's page for an entity (see entities-core.js). name and info are
      // a copy for display and for older versions; the entity is what counts.
      mainType: /^[a-z0-9-]{1,40}$/.test(g.mainType || "") ? g.mainType : "",
      mainTags: (Array.isArray(g.mainTags) ? g.mainTags : []).slice(0, MAX.tags).map((t) => ({
        id: t.id || uid(), name: clampStr(t.name, MAX.name) || "Untitled", color: isColor(t.color) ? t.color : COLORS[5], info: clampStr(t.info, MAX.desc),
        entity: typeof t.entity === "string" && t.entity ? t.entity.slice(0, 80) : null
      })),
      fields: {
        amount: { on: amount.on !== false, currency: currencyOk(amount.currency) ? amount.currency : "INR" },
        rating: !!fields.rating,
        custom: (Array.isArray(fields.custom) ? fields.custom : []).slice(0, MAX.custom).map((f) => ({
          id: f.id || uid(), name: clampStr(f.name, MAX.label) || "Field",
          type: FIELD_TYPES.includes(f.type) ? f.type : "text", unit: clampStr(f.unit, MAX.unit),
          stat: FIELD_STATS.includes(f.stat) ? f.stat : "none"
        }))
      },
      cards: CARD_MODES.includes(g.cards) ? g.cards : "none",
      cardWord: clampStr(g.cardWord, MAX.label),
      createdAt: g.createdAt || Date.now(),
      updatedAt: g.updatedAt || Date.now(),
      order: typeof g.order === "number" ? g.order : (g.createdAt || Date.now())
    };
    if (!out.mainLabel) out.cards = out.cards === "title" ? "none" : out.cards;
    return out;
  }

  // An entry: one thing dropped into one or more groups. Amounts are kept in
  // minor units (paise, cents) so totals never pick up rounding errors.
  function normalizeEntry(e) {
    const now = Date.now();
    return {
      id: e.id || uid(),
      schema: ENTRY_SCHEMA,
      refs: (Array.isArray(e.refs) ? e.refs : []).filter((r) => r && r.g).map((r) => ({ g: String(r.g), s: r.s || null, tag: r.tag || null })),
      title: String(e.title || "").slice(0, 300),
      note: String(e.note || "").slice(0, 20000),
      tags: (Array.isArray(e.tags) ? e.tags : []).map(normalizeTagName).filter(Boolean).slice(0, 20),
      amount: Number.isInteger(e.amount) ? e.amount : null,
      currency: e.currency && currencyOk(e.currency) ? e.currency : null,
      rating: Number.isInteger(e.rating) && e.rating >= 1 && e.rating <= 5 ? e.rating : null,
      fields: e.fields && typeof e.fields === "object" ? { ...e.fields } : {},
      photos: (Array.isArray(e.photos) ? e.photos : []).filter((p) => typeof p === "string" && /^data:image\/(jpeg|png|webp|gif);/.test(p)),
      link: e.link ? String(e.link).slice(0, 2000) : null,
      // A snap's original photo and how, when and where it was taken (see snap.js).
      capture: e.capture && window.CPSnap ? window.CPSnap.normalizeCapture(e.capture) : null,
      // Files forwarded from the Me chat (PDFs and the like), kept as they were.
      files: (Array.isArray(e.files) ? e.files : []).filter((f) => f && typeof f.data === "string" && /^data:[\w.+-]+\/[\w.+-]+(;[\w=.+-]+)*;base64,/.test(f.data) && !/^data:(text\/html|image\/svg)/i.test(f.data))
        .slice(0, 10).map((f) => ({ name: String(f.name || "file").slice(0, 200), type: String(f.type || "application/octet-stream").slice(0, 100), size: Number(f.size) || 0, data: f.data })),
      happenedOn: typeof e.happenedOn === "number" ? e.happenedOn : (e.addedOn || now),
      addedOn: typeof e.addedOn === "number" ? e.addedOn : now,
      updatedAt: e.updatedAt || now,
      // Set when moved to Trash; kept 30 days, then removed for good.
      deletedAt: typeof e.deletedAt === "number" ? e.deletedAt : null
    };
  }

  // #Chai, chai and " chai " are the same tag.
  function normalizeTagName(t) {
    return String(t || "").trim().replace(/^#+/, "").toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 40);
  }

  // ---------- Money ----------
  const toMinor = (str) => {
    const n = Number(String(str).replace(/[, ]/g, ""));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
  };
  function formatMoney(minor, currency) {
    const code = currencyOk(currency) ? currency : "INR";
    const value = minor / 100;
    try {
      return new Intl.NumberFormat(code === "INR" ? "en-IN" : undefined, { style: "currency", currency: code, maximumFractionDigits: value % 1 ? 2 : 0 }).format(value);
    } catch { return code + " " + value; }
  }
  const entryCurrency = (e, g) => e.currency || g.fields.amount.currency;
  // Totals per currency: { INR: 164000, USD: 3500 }. Never converted.
  function totals(list, g) {
    const out = {};
    for (const e of list) if (e.amount) { const c = entryCurrency(e, g); out[c] = (out[c] || 0) + e.amount; }
    return out;
  }
  function formatTotals(t, g) {
    const keys = Object.keys(t);
    if (!keys.length) return formatMoney(0, g.fields.amount.currency);
    keys.sort((a, b) => (a === g.fields.amount.currency ? -1 : b === g.fields.amount.currency ? 1 : a.localeCompare(b)));
    return keys.map((k) => formatMoney(t[k], k)).join(" + ");
  }

  // ---------- Queries ----------
  const refIn = (e, gid) => e.refs.find((r) => r.g === gid);
  const subOf = (g, sid) => g.subs.find((s) => s.id === sid) || null;
  const tagOf = (g, tid) => g.mainTags.find((t) => t.id === tid) || null;
  const sameDay = (a, b) => { const x = new Date(a), y = new Date(b); return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate(); };
  const monthKey = (t) => { const d = new Date(t); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); };

  // Everything shown skips entries in Trash.
  function inGroup(entries, gid) { return entries.filter((e) => !e.deletedAt && refIn(e, gid)); }
  function inSub(entries, gid, sid) { return inGroup(entries, gid).filter((e) => !sid || sid === "all" || refIn(e, gid).s === sid); }
  // tag: a main-tag id, "__none" (no main tag) or null (everything).
  function filterEntries(entries, g, sid, tag, query) {
    let list = inSub(entries, g.id, sid);
    if (tag === "__none") list = list.filter((e) => !tagOf(g, refIn(e, g.id).tag));
    else if (tag) list = list.filter((e) => refIn(e, g.id).tag === tag);
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((e) => entryText(e, g).includes(q));
    }
    return list;
  }
  function entryText(e, g) {
    const r = g ? refIn(e, g.id) : null;
    const t = g && r ? tagOf(g, r.tag) : null;
    return [e.title, e.note, e.link, ...e.tags, t && t.name, t && t.info, ...Object.values(e.fields || {})].filter(Boolean).join(" ").toLowerCase();
  }
  // Counts that always add up: per sub-chat and per main tag.
  function counts(entries, g, sid) {
    const all = inGroup(entries, g.id);
    const bySub = {}; g.subs.forEach((s) => { bySub[s.id] = 0; });
    let noSub = 0;
    all.forEach((e) => { const s = refIn(e, g.id).s; if (s && s in bySub) bySub[s]++; else noSub++; });
    const base = inSub(entries, g.id, sid);
    const byTag = {}; g.mainTags.forEach((t) => { byTag[t.id] = 0; });
    let noTag = 0, noTagNeeded = 0;
    base.forEach((e) => {
      const r = refIn(e, g.id);
      if (r.tag && r.tag in byTag) byTag[r.tag]++;
      else { noTag++; const s = subOf(g, r.s); if (!(s && s.noTag)) noTagNeeded++; }
    });
    return { all: all.length, bySub, noSub, base: base.length, byTag, noTag, noTagNeeded };
  }

  // ---------- Cards ----------
  // "day": same main tag on the same day = one card (a Visit, an Outing). A
  //   sub-chat marked "late" (Lab Reports, Bills) also joins up to 7 days later.
  // "title": every entry with the same main tag = one card (a show you watch for weeks).
  // Cards only form in a group's All view; a sub-chat lists entries one by one.
  function buildCards(list, g, sid) {
    const sorted = [...list].sort((a, b) => a.happenedOn - b.happenedOn || a.addedOn - b.addedOn);
    const tagFor = (e) => { const r = refIn(e, g.id); return r && tagOf(g, r.tag) ? r.tag : null; };
    const single = (e) => ({ kind: "single", key: "s-" + e.id, tag: tagFor(e), items: [e], start: e.happenedOn, anchor: e.happenedOn });
    if ((sid && sid !== "all") || g.cards === "none" || !g.mainLabel) return sorted.map(single);
    const out = [];
    if (g.cards === "title") {
      const byTag = new Map();
      for (const e of sorted) {
        const tag = tagFor(e);
        if (!tag) { out.push(single(e)); continue; }
        if (!byTag.has(tag)) { const c = { kind: "title", key: "t-" + tag, tag, items: [] }; byTag.set(tag, c); out.push(c); }
        byTag.get(tag).items.push(e);
      }
    } else {
      for (const e of sorted) {
        const tag = tagFor(e);
        if (!tag) { out.push(single(e)); continue; }
        const s = subOf(g, refIn(e, g.id).s);
        let target = null;
        for (let i = out.length - 1; i >= 0; i--) {
          const c = out[i];
          if (c.kind !== "group" || c.tag !== tag) continue;
          if (sameDay(c.start, e.happenedOn) || (s && s.late && e.happenedOn >= c.start && e.happenedOn - c.start <= LATE_JOIN_DAYS * DAY)) { target = c; }
          break;
        }
        if (target) target.items.push(e);
        else out.push({ kind: "group", key: "g-" + tag + "-" + e.happenedOn, tag, items: [e], start: e.happenedOn });
      }
    }
    return out.map((c) => {
      if (c.kind === "group" && c.items.length === 1) return single(c.items[0]);
      c.start = c.items[0].happenedOn;
      c.anchor = c.kind === "title" ? c.items[c.items.length - 1].happenedOn : c.start;
      return c;
    });
  }

  // What a Title card shows: status from the latest entry, latest rating and field values.
  function titleSummary(c, g) {
    const statusItems = c.items.filter((e) => { const s = subOf(g, refIn(e, g.id).s); return s && !s.noStatus; });
    const last = statusItems[statusItems.length - 1];
    const status = last ? subOf(g, refIn(last, g.id).s) : null;
    const rated = c.items.filter((e) => e.rating);
    const latestField = {};
    g.fields.custom.forEach((f) => {
      for (let i = c.items.length - 1; i >= 0; i--) { const v = c.items[i].fields[f.id]; if (v !== undefined && v !== "" && v !== null) { latestField[f.id] = v; break; } }
    });
    const photo = [...c.items].reverse().find((e) => e.photos.length);
    return { status, rating: rated.length ? rated[rated.length - 1].rating : null, latestField, photo: photo ? photo.photos[0] : null };
  }

  // ---------- Header stats (react to the active filter) ----------
  // A card only counts as a visit/outing when something in it isn't a
  // "late" kind: a pharmacy bill or lab report on its own isn't a visit.
  function countsAsVisit(c, g) {
    return !!c.tag && c.items.some((e) => { const s = subOf(g, refIn(e, g.id).s); return !(s && s.late); });
  }
  function stats(entries, g, sid, list) {
    const out = [];
    const sub = sid && sid !== "all" ? subOf(g, sid) : null;
    const cards = buildCards(list, g, "all");
    const tagged = cards.filter((c) => countsAsVisit(c, g));
    if (sub) out.push({ key: "count", icon: sub.icon, label: sub.name, value: String(list.length) });
    else if (g.cards === "title" && g.mainLabel) out.push({ key: "count", icon: g.icon, label: plural(g.cardWord || g.mainLabel), value: String(cards.filter((c) => c.kind === "title").length) });
    else if (g.cards === "day" && g.mainLabel) out.push({ key: "count", icon: "calendar", label: plural(g.cardWord || "Visit"), value: String(tagged.length) });
    else out.push({ key: "count", icon: "note", label: "Entries", value: String(list.length) });
    // Money tiles only when there's money to show.
    if (g.fields.amount.on && list.some((e) => e.amount)) {
      out.push({ key: "total", icon: "wallet", label: "Total spent", value: formatTotals(totals(list, g), g) });
      const now = new Date();
      const thisMonth = list.filter((e) => { const d = new Date(e.happenedOn); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); });
      if (thisMonth.some((e) => e.amount)) out.push({ key: "month", icon: "calendar", label: "Spent in " + now.toLocaleDateString("en-GB", { month: "short" }), value: formatTotals(totals(thisMonth, g), g) });
    }
    if (g.mainLabel && g.mainTags.length && g.cards !== "title") {
      const per = {};
      (g.cards === "none" ? list.map((e) => ({ tag: refIn(e, g.id).tag })) : tagged).forEach((c) => { if (c.tag && tagOf(g, c.tag)) per[c.tag] = (per[c.tag] || 0) + 1; });
      const top = Object.entries(per).sort((a, b) => b[1] - a[1])[0];
      const unit = g.cards === "none" ? (top && top[1] === 1 ? "entry" : "entries") : (g.cardWord || "visit").toLowerCase() + (top && top[1] === 1 ? "" : "s");
      if (top) out.push({ key: "top", icon: "star", label: "Top " + g.mainLabel.toLowerCase() + " \u00b7 " + top[1] + " " + unit, value: tagOf(g, top[0]).name });
    }
    if (g.fields.rating) {
      const rated = list.filter((e) => e.rating);
      out.push({ key: "rating", icon: "star", label: "Avg rating", value: rated.length ? (rated.reduce((t, e) => t + e.rating, 0) / rated.length).toFixed(1) : "–" });
    }
    for (const f of g.fields.custom) {
      if (f.type !== "number" || f.stat === "none") continue;
      const vals = [...list].sort((a, b) => a.happenedOn - b.happenedOn).map((e) => Number(e.fields[f.id])).filter((v) => Number.isFinite(v));
      if (!vals.length) continue;
      const v = f.stat === "sum" ? vals.reduce((t, x) => t + x, 0) : vals[vals.length - 1];
      out.push({ key: "f-" + f.id, icon: "note", label: (f.stat === "sum" ? "Total " : "Latest ") + f.name.toLowerCase(), value: formatNumber(v) + (f.unit ? " " + f.unit : "") });
    }
    return out;
  }
  // Fill-up maths for vehicles, from entries with an odometer reading:
  // the latest fill-up against the one before it (the full-tank method).
  function fuelStats(list, g) {
    const num = (f) => f.type === "number";
    const odo = g.fields.custom.find((f) => num(f) && (/odo/i.test(f.name) || f.unit === "km"));
    if (!odo) return null;
    const lit = g.fields.custom.find((f) => num(f) && (/lit(re|er)|fuel|units|kwh/i.test(f.name) || f.unit === "L" || f.unit === "kWh"));
    // Only fill-ups count (a service with an odometer reading would throw the maths off).
    const fuelSub = g.subs.find((x) => /fuel|petrol|diesel|fill|charg|cng/i.test(x.name));
    if (fuelSub) list = list.filter((e) => (e.refs || []).some((r) => r.g === g.id && r.s === fuelSub.id));
    const fills = list.map((e) => ({ e, km: Number(e.fields[odo.id]), l: lit ? Number(e.fields[lit.id]) : NaN }))
      .filter((x) => Number.isFinite(x.km) && x.km > 0).sort((a, b) => a.km - b.km || a.e.happenedOn - b.e.happenedOn);
    if (fills.length < 2) return fills.length ? { lastKm: fills[0].km } : null;
    const last = fills[fills.length - 1], prev = fills[fills.length - 2];
    const dist = last.km - prev.km;
    if (!(dist > 0)) return { lastKm: last.km };
    const cur = entryCurrency(last.e, g);
    const out = { lastKm: last.km, dist, currency: cur };
    if (last.e.amount > 0) out.perKm = last.e.amount / 100 / dist;
    if (Number.isFinite(last.l) && last.l > 0) out.perUnit = dist / last.l;
    // Over every fill-up after the first: overall km per litre.
    const later = fills.slice(1).filter((x) => Number.isFinite(x.l) && x.l > 0);
    const span = fills[fills.length - 1].km - fills[0].km;
    if (later.length >= 2 && span > 0) out.avgPerUnit = span / later.reduce((t, x) => t + x.l, 0);
    out.unit = lit && (lit.unit === "kWh" || /kwh|units/i.test(lit.name)) ? "kWh" : "L";
    return out;
  }
  const plural = (w) => (!w ? "Entries" : /s$/i.test(w) ? w : w + "s");
  const formatNumber = (v) => (Math.round(v * 100) / 100).toLocaleString("en-IN");

  // ---------- Template sharing (structure only, never entries or personal tags) ----------
  function templateFromGroup(g) {
    return {
      cpTemplate: 1,
      name: g.name, desc: g.desc, icon: g.icon, color: g.color,
      subs: g.subs.map((s) => ({ name: s.name, label: s.label, icon: s.icon, color: s.color, late: s.late || undefined, noTag: s.noTag || undefined, noStatus: s.noStatus || undefined })),
      mainLabel: g.mainLabel, mainType: g.mainType || undefined,
      fields: { amount: { on: g.fields.amount.on, currency: g.fields.amount.currency }, rating: g.fields.rating,
        custom: g.fields.custom.map((f) => ({ name: f.name, type: f.type, unit: f.unit, stat: f.stat })) },
      cards: g.cards, cardWord: g.cardWord
    };
  }
  // Imported templates are untrusted: only known keys survive, everything is length-capped and checked.
  function validateTemplate(raw) {
    if (!raw || typeof raw !== "object" || raw.cpTemplate !== 1) throw new Error("This isn't a CopyPaster template.");
    const g = normalizeGroup({ ...raw, id: "preview", mainTags: [], cover: null });
    return { name: g.name, desc: g.desc, icon: g.icon, color: g.color,
      subs: g.subs.map(({ id, ...s }) => s), mainLabel: g.mainLabel, mainType: g.mainType,
      fields: { amount: g.fields.amount, rating: g.fields.rating, custom: g.fields.custom.map(({ id, ...f }) => f) },
      cards: g.cards, cardWord: g.cardWord };
  }
  function encodeTemplate(t) {
    const bytes = new TextEncoder().encode(JSON.stringify(t));
    let bin = ""; bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function decodeTemplate(str) {
    if (!str || str.length > 20000) throw new Error("This template link is damaged.");
    const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return validateTemplate(JSON.parse(new TextDecoder().decode(bytes)));
  }

  window.CPGroupsCore = {
    DAY, ICONS, COLORS, CURRENCIES, FIELD_TYPES, CARD_MODES, TEMPLATES, templateSections, MAX,
    uid, normalizeGroup, normalizeEntry, normalizeTagName, groupFromTemplate,
    toMinor, formatMoney, formatTotals, totals, entryCurrency, formatNumber, plural,
    refIn, subOf, tagOf, sameDay, monthKey, inGroup, inSub, filterEntries, entryText, counts,
    buildCards, titleSummary, stats, countsAsVisit, fuelStats,
    templateFromGroup, validateTemplate, encodeTemplate, decodeTemplate
  };
})();
