// CopyPaster password builder: the rules, no screen code. window.CPPassword
//
// Every random choice uses the browser's secure random numbers
// (crypto.getRandomValues) with rejection sampling, so no character is more
// likely than another. Nothing here is stored or sent anywhere.
(function () {
  "use strict";

  const SETS = {
    upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    lower: "abcdefghijklmnopqrstuvwxyz",
    digits: "0123456789",
    symbols: "!@#$%^&*-_=+?"
  };
  const ALL_SYMBOLS = "!@#$%^&*()-_=+[]{};:,.?/~|<>";
  const LOOK_ALIKES = "Il1O0o|";
  const KINDS = ["upper", "lower", "digits", "symbols"];
  const NAMES = { upper: "capitals", lower: "small letters", digits: "numbers", symbols: "special characters" };
  const MIN_LENGTH = 4, MAX_LENGTH = 128;

  // Words for memorable passwords: short, common, easy to spell.
  const WORDS = [
    "able", "acid", "acorn", "actor", "adult", "agent", "alarm", "album", "alert", "alien", "alley", "alpha", "amber",
    "anchor", "angle", "ankle", "apple", "apron", "arena", "armor", "arrow", "artist", "aspen", "atlas", "attic",
    "audio", "aunt", "autumn", "avocado", "award", "axis", "bacon", "badge", "bagel", "baker", "balcony", "ball",
    "bamboo", "banana", "band", "banjo", "barn", "barrel", "basil", "basket", "batch", "beach", "beacon", "bean",
    "bear", "beaver", "bedroom", "beetle", "bell", "belt", "bench", "berry", "bicycle", "bird", "biscuit", "blade",
    "blanket", "blender", "blossom", "board", "boat", "bonfire", "book", "boot", "border", "bottle", "boulder",
    "bowl", "box", "brain", "branch", "brass", "bread", "breeze", "brick", "bridge", "broom", "brook", "brush",
    "bubble", "bucket", "buffalo", "bugle", "bunny", "butter", "button", "cabin", "cable", "cactus", "cake", "camel",
    "camera", "camp", "candle", "candy", "canoe", "canvas", "canyon", "captain", "carbon", "cargo", "carpet",
    "carrot", "castle", "cattle", "cave", "cedar", "celery", "cello", "chair", "chalk", "channel", "cheese", "cherry",
    "chess", "chicken", "chimney", "chip", "choir", "cider", "cinema", "circle", "circus", "citrus", "city", "clam",
    "clay", "cliff", "clock", "cloud", "clover", "coach", "coast", "cobalt", "cocoa", "coconut", "coffee", "comet",
    "compass", "copper", "coral", "corn", "cotton", "couch", "cougar", "country", "cousin", "cowboy", "crab",
    "cradle", "crane", "crayon", "cream", "creek", "cricket", "crown", "crystal", "cub", "cupcake", "curtain",
    "cushion", "daisy", "dancer", "dawn", "deer", "delta", "desert", "desk", "diamond", "diary", "dinner", "dish",
    "doctor", "dolphin", "domino", "donkey", "donut", "door", "dragon", "drawer", "dream", "dress", "drum", "duck",
    "dune", "eagle", "earth", "easel", "echo", "eclipse", "elbow", "elephant", "elm", "ember", "emerald", "engine",
    "envelope", "falcon", "fabric", "farm", "feather", "fence", "fern", "ferry", "festival", "fiddle", "field", "fig",
    "finch", "fire", "fish", "flag", "flame", "flannel", "flask", "fleet", "flower", "flute", "fog", "folder",
    "forest", "fork", "fossil", "fountain", "fox", "frame", "frog", "frost", "fruit", "fudge", "galaxy", "garage",
    "garden", "garlic", "gate", "gecko", "gem", "giant", "ginger", "giraffe", "glacier", "glass", "globe", "glove",
    "goat", "gold", "goose", "gorilla", "grape", "grass", "gravel", "guitar", "gull", "hammer", "hammock", "harbor",
    "harp", "hat", "hawk", "hazel", "helmet", "hen", "herb", "heron", "hill", "hippo", "hive", "honey", "hood",
    "hook", "horizon", "horse", "hotel", "house", "husky", "igloo", "iguana", "insect", "iris", "island", "ivory",
    "ivy", "jacket", "jaguar", "jam", "jar", "jasmine", "jeans", "jelly", "jet", "jewel", "jigsaw", "journal",
    "judge", "juice", "jungle", "kayak", "kettle", "key", "kite", "kitten", "kiwi", "koala", "ladder", "lagoon",
    "lake", "lamb", "lamp", "lantern", "laptop", "lark", "lava", "lawn", "leaf", "lemon", "lens", "leopard", "letter",
    "lettuce", "library", "lily", "lime", "linen", "lion", "lizard", "llama", "lobster", "locket", "lodge", "lotus",
    "lunar", "magnet", "mango", "maple", "marble", "market", "meadow", "melon", "mermaid", "metal", "meteor", "mint",
    "mirror", "mitten", "mole", "monkey", "moon", "moose", "moss", "motor", "mountain", "mouse", "muffin", "mule",
    "museum", "mushroom", "napkin", "needle", "nest", "net", "noodle", "north", "notebook", "nugget", "nutmeg", "oak",
    "oasis", "ocean", "octopus", "olive", "onion", "orange", "orbit", "orchid", "ostrich", "otter", "owl", "oyster",
    "paddle", "paint", "palace", "palm", "panda", "paper", "parade", "parrot", "pasta", "peach", "peacock", "peanut",
    "pear", "pebble", "pelican", "pencil", "penguin", "pepper", "piano", "pickle", "pigeon", "pillow", "pilot",
    "pine", "pirate", "pizza", "planet", "plum", "pocket", "poem", "polar", "pony", "popcorn", "poppy", "portal",
    "potato", "pottery", "prairie", "prism", "pudding", "puffin", "pumpkin", "puppet", "puzzle", "quail", "quartz",
    "queen", "quilt", "rabbit", "raccoon", "radar", "radio", "rain", "raisin", "ranch", "raven", "reef", "ribbon",
    "rice", "ridge", "river", "robin", "rocket", "rose", "rover", "ruby", "rug", "saddle", "sailor", "salad",
    "salmon", "sand", "sandal", "satin", "scarf", "school", "scooter", "seal", "season", "seed", "shadow", "shark",
    "sheep", "shell", "shield", "ship", "shore", "silver", "singer", "skate", "sky", "sled", "slipper", "snail",
    "snow", "soap", "sock", "sofa", "soup", "spark", "sparrow", "spider", "spoon", "spring", "sprout", "squid",
    "stamp", "star", "station", "statue", "stone", "storm", "straw", "stream", "street", "sugar", "summer", "sun",
    "swan", "sweater", "table", "taco", "tango", "teapot", "temple", "tent", "thunder", "tiger", "timber", "toast",
    "tomato", "topaz", "torch", "tower", "tractor", "trail", "train", "tree", "trophy", "trout", "trumpet", "tulip",
    "tuna", "tunnel", "turkey", "turtle", "tuxedo", "umbrella", "unicorn", "valley", "vanilla", "velvet", "violet",
    "violin", "volcano", "wafer", "wagon", "walnut", "walrus", "wand", "water", "wave", "whale", "wheat", "whistle",
    "willow", "window", "winter", "wizard", "wolf", "wombat", "wood", "yacht", "yak", "yarn", "yogurt", "zebra",
    "zero", "zinc", "zipper", "zone"
  ];

  // A secure random whole number from 0 to n-1, without bias.
  function randomIndex(n) {
    if (!(n > 0)) throw new Error("Nothing to choose from");
    const limit = Math.floor(0x100000000 / n) * n;
    const buf = new Uint32Array(1);
    do crypto.getRandomValues(buf); while (buf[0] >= limit);
    return buf[0] % n;
  }
  const pick = (str) => str[randomIndex(str.length)];
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) { const j = randomIndex(i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  }

  // The characters one kind may use, after the user's choices.
  function charset(kind, opts = {}) {
    let s = kind === "symbols" ? cleanSymbols(opts.symbolSet) : SETS[kind];
    if (opts.avoidSimilar) s = [...s].filter((c) => !LOOK_ALIKES.includes(c)).join("");
    return s;
  }
  // Only real special characters, each once. Empty means the default list.
  function cleanSymbols(str) {
    if (str == null || str === "") return SETS.symbols;
    return [...new Set([...String(str)].filter((c) => /[^\p{L}\p{N}\s]/u.test(c) && c.charCodeAt(0) < 0x7f))].join("");
  }

  const clampLength = (n) => Math.max(MIN_LENGTH, Math.min(MAX_LENGTH, Math.round(Number(n) || 0)));

  // Simple mode: a length and which kinds to use. Every kind that's on
  // appears at least once.
  function generate(opts = {}) {
    const length = clampLength(opts.length || 20);
    const kinds = KINDS.filter((k) => opts[k] !== false);
    if (!kinds.length) throw new Error("Turn on at least one kind of character.");
    const sets = kinds.map((k) => charset(k, opts));
    if (sets.some((s) => !s.length)) throw new Error("Add at least one allowed special character.");
    if (length < kinds.length) throw new Error("Make it at least " + kinds.length + " characters long.");
    const chars = sets.map(pick);
    const all = sets.join("");
    while (chars.length < length) chars.push(pick(all));
    return shuffle(chars).join("");
  }

  // Exact mode: how many of each kind. `fill` names the kind that takes
  // whatever is left of the length. Returns { counts, total, problem }.
  function planExact(opts = {}) {
    const length = clampLength(opts.length || 12);
    const counts = {};
    for (const k of KINDS) counts[k] = Math.max(0, Math.round(Number(opts.counts && opts.counts[k]) || 0));
    if (opts.fill && KINDS.includes(opts.fill)) {
      const others = KINDS.filter((k) => k !== opts.fill).reduce((t, k) => t + counts[k], 0);
      counts[opts.fill] = Math.max(0, length - others);
    }
    const total = KINDS.reduce((t, k) => t + counts[k], 0);
    let problem = null;
    if (total > length) problem = "That's " + total + " characters. Remove " + (total - length) + ", or raise the length to " + total + ".";
    else if (total < length) problem = "That's " + total + " of " + length + ". Add " + (length - total) + " more, or lower the length to " + Math.max(MIN_LENGTH, total) + ".";
    else if (!total) problem = "Choose at least one character.";
    for (const k of KINDS) if (counts[k] && !charset(k, opts).length) problem = "Add at least one allowed special character.";
    return { length, counts, total, problem };
  }
  function generateExact(opts = {}) {
    const plan = planExact(opts);
    if (plan.problem) throw new Error(plan.problem);
    const chars = [];
    for (const k of KINDS) { const set = charset(k, opts); for (let i = 0; i < plan.counts[k]; i++) chars.push(pick(set)); }
    return shuffle(chars).join("");
  }

  // Random words, like river-tiger-cloud-42.
  function memorable(opts = {}) {
    const words = Math.max(3, Math.min(10, Math.round(opts.words || 5)));
    const sep = opts.separator == null ? "-" : String(opts.separator).slice(0, 3);
    const parts = [];
    for (let i = 0; i < words; i++) {
      let w = WORDS[randomIndex(WORDS.length)];
      if (opts.capitalize) w = w[0].toUpperCase() + w.slice(1);
      parts.push(w);
    }
    if (opts.number !== false) parts.push(String(randomIndex(90) + 10));
    return parts.join(sep);
  }

  function pin(length = 6) {
    const n = Math.max(4, Math.min(12, Math.round(length)));
    let out = "";
    for (let i = 0; i < n; i++) out += pick(SETS.digits);
    return out;
  }

  // Easy to type: three groups of six, like Apple's (one capital, one number).
  function easy() {
    const lower = charset("lower", { avoidSimilar: true });
    const chars = [];
    for (let i = 0; i < 18; i++) chars.push(pick(lower));
    const capAt = randomIndex(18);
    let digitAt = randomIndex(17); if (digitAt >= capAt) digitAt++;
    chars[capAt] = pick(charset("upper", { avoidSimilar: true }));
    chars[digitAt] = pick(charset("digits", { avoidSimilar: true }));
    return [chars.slice(0, 6), chars.slice(6, 12), chars.slice(12)].map((g) => g.join("")).join("-");
  }

  // ---------- How strong ----------
  const log2 = Math.log2;
  function logFactorial(n) { let s = 0; for (let i = 2; i <= n; i++) s += log2(i); return s; }

  // Bits of randomness of how a password was made (not a guess from the text).
  function entropy(mode, opts = {}) {
    if (mode === "memorable") {
      const words = Math.max(3, Math.min(10, Math.round(opts.words || 5)));
      return words * log2(WORDS.length) + (opts.number !== false ? log2(90) : 0);
    }
    if (mode === "pin") return Math.max(4, Math.min(12, Math.round(opts.length || 6))) * log2(10);
    if (mode === "easy") return 16 * log2(charset("lower", { avoidSimilar: true }).length) + log2(18 * 17) +
      log2(charset("upper", { avoidSimilar: true }).length) + log2(charset("digits", { avoidSimilar: true }).length);
    if (mode === "exact") {
      const plan = planExact(opts);
      if (plan.problem) return 0;
      let bits = logFactorial(plan.length);
      for (const k of KINDS) bits += plan.counts[k] * log2(charset(k, opts).length || 1) - logFactorial(plan.counts[k]);
      return bits;
    }
    const length = clampLength(opts.length || 20);
    const pool = KINDS.filter((k) => opts[k] !== false).map((k) => charset(k, opts)).join("").length;
    return pool ? length * log2(pool) : 0;
  }
  // Rough time for a fast offline attack (10 billion guesses a second), on average.
  function crackTime(bits) {
    const seconds = Math.pow(2, bits - 1) / 1e10;
    const say = (n, word) => { const r = Math.max(1, Math.round(n)); return r + " " + word + (r === 1 ? "" : "s"); };
    if (seconds < 1) return "instantly";
    if (seconds < 60) return say(seconds, "second");
    if (seconds < 3600) return say(seconds / 60, "minute");
    if (seconds < 86400) return say(seconds / 3600, "hour");
    const years = seconds / (86400 * 365.25);
    if (years < 1) return say(seconds / 86400, "day");
    if (years < 1000) return say(years, "year");
    if (years < 1e6) return "thousands of years";
    if (years < 1e9) return "millions of years";
    return "billions of years";
  }
  function strength(bits) {
    const level = bits < 36 ? 0 : bits < 60 ? 1 : bits < 80 ? 2 : 3;
    return { bits: Math.round(bits), level, label: ["Weak", "Fair", "Strong", "Very strong"][level], time: crackTime(bits) };
  }

  // ---------- Presets ----------
  const PRESETS = [
    { id: "strong", name: "Strong", hint: "20 characters, every kind", mode: "simple", opts: { length: 20, upper: true, lower: true, digits: true, symbols: true, avoidSimilar: true } },
    { id: "nosym", name: "No special characters", hint: "For sites that refuse symbols", mode: "simple", opts: { length: 20, upper: true, lower: true, digits: true, symbols: false, avoidSimilar: true } },
    { id: "easy", name: "Easy to type", hint: "Like abcdef-ghjkmn-pq7rSt", mode: "easy", opts: {} },
    { id: "pin", name: "PIN", hint: "Numbers only", mode: "pin", opts: { length: 6 } },
    { id: "memorable", name: "Memorable", hint: "Words, like river-tiger-cloud-42", mode: "memorable", opts: { words: 5, separator: "-", number: true, capitalize: false } }
  ];

  function make(mode, opts) {
    if (mode === "exact") return generateExact(opts);
    if (mode === "memorable") return memorable(opts);
    if (mode === "pin") return pin(opts.length);
    if (mode === "easy") return easy();
    return generate(opts);
  }

  window.CPPassword = {
    SETS, ALL_SYMBOLS, KINDS, NAMES, MIN_LENGTH, MAX_LENGTH, WORDS, PRESETS,
    randomIndex, charset, cleanSymbols, generate, planExact, generateExact, memorable, pin, easy, make,
    entropy, crackTime, strength
  };
})();
