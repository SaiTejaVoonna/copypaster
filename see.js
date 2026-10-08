// CopyPaster See: a rough guess at what a photo shows, worked out on this
// device. window.CPSee
//
// The photo never leaves the phone. The first time it's used, the browser
// downloads a small image model (about 5 MB, plus the code that runs it) and
// keeps it; after that it works offline. The answer is only a suggestion
// ("Looks like food"); nothing is filed or renamed because of it.
(function () {
  "use strict";

  const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21";
  const MODEL = "https://storage.googleapis.com/mediapipe-models/image_classifier/efficientnet_lite0/int8/1/efficientnet_lite0.tflite";
  const MIN_SCORE = 0.12;

  // Broad kinds, from the model's 1000 everyday labels.
  const KINDS = [
    { key: "food", label: "Food", words: ["pizza", "cheeseburger", "hotdog", "ice cream", "ice lolly", "trifle", "burrito", "bagel", "pretzel", "guacamole", "consomme", "hot pot",
      "carbonara", "espresso", "eggnog", "chocolate sauce", "dough", "meat loaf", "potpie", "mashed potato", "french loaf", "head cabbage", "broccoli", "cauliflower", "zucchini",
      "spaghetti squash", "acorn squash", "butternut squash", "cucumber", "bell pepper", "cardoon", "mushroom", "granny smith", "strawberry", "orange", "lemon", "fig", "pineapple",
      "banana", "jackfruit", "custard apple", "pomegranate", "corn", "red wine", "beer glass", "beer bottle", "wine bottle", "coffee mug", "cup", "teapot", "soup bowl", "plate",
      "frying pan", "wok", "mixing bowl", "waffle iron", "dining table", "restaurant", "bakery", "confectionery", "butcher shop", "grocery store", "pop bottle", "water bottle", "menu"] },
    { key: "document", label: "Paper or document", words: ["envelope", "book jacket", "comic book", "crossword puzzle", "packet", "binder", "notebook", "web site", "rule",
      "slide rule", "paper towel", "toilet tissue"] },
    { key: "screen", label: "Screen or device", words: ["laptop", "desktop computer", "monitor", "screen", "computer keyboard", "mouse", "cellular telephone", "ipod", "television",
      "remote control", "hand-held computer", "modem", "printer", "projector", "loudspeaker", "joystick", "space bar", "typewriter keyboard"] },
    { key: "medicine", label: "Medicine or health", words: ["pill bottle", "medicine chest", "syringe", "stethoscope", "band aid", "lotion", "sunscreen"] },
    { key: "vehicle", label: "Vehicle", words: ["sports car", "convertible", "cab", "jeep", "minivan", "moped", "motor scooter", "mountain bike", "bicycle-built-for-two", "ambulance",
      "school bus", "trolleybus", "minibus", "trailer truck", "pickup", "police van", "racer", "limousine", "beach wagon", "car wheel", "crash helmet", "disc brake", "tow truck",
      "garbage truck", "fire engine", "go-kart", "golfcart", "recreational vehicle", "passenger car", "streetcar", "electric locomotive", "steam locomotive", "airliner", "airship", "speedboat"] },
    { key: "place", label: "Place", words: ["cinema", "library", "church", "mosque", "palace", "monastery", "castle", "boathouse", "barbershop", "bookshop", "toyshop", "shoe shop",
      "tobacco shop", "home theater", "theater curtain", "planetarium", "stupa", "triumphal arch", "suspension bridge", "steel arch bridge", "fountain", "patio", "lakeside", "seashore",
      "alp", "valley", "volcano", "cliff", "promontory", "sandbar", "coral reef", "geyser", "dock", "pier", "prison", "greenhouse", "shopping basket", "shopping cart"] },
    { key: "clothes", label: "Clothes", words: ["jersey", "sweatshirt", "cardigan", "suit", "kimono", "abaya", "sarong", "jean", "miniskirt", "trench coat", "fur coat", "lab coat",
      "running shoe", "loafer", "sandal", "cowboy boot", "sunglasses", "sunglass", "wallet", "purse", "backpack", "handbag", "watch", "digital watch"] }
  ];
  const fold = (s) => String(s || "").toLowerCase().trim();
  function kindOf(name, index) {
    const n = fold(name);
    if (Number.isFinite(index)) {
      if (index >= 151 && index <= 268) return { key: "pet", label: "Dog" };
      if (index >= 281 && index <= 285) return { key: "pet", label: "Cat" };
      if (index >= 0 && index < 398) return { key: "animal", label: "Animal" };
    }
    for (const k of KINDS) if (k.words.some((w) => n === w || n.split(/,\s*/).includes(w))) return { key: k.key, label: k.label };
    return null;
  }

  // The model's top answers → one suggestion, or null when it isn't sure.
  function suggest(categories) {
    const list = (Array.isArray(categories) ? categories : []).filter((c) => c && Number.isFinite(c.score));
    if (!list.length) return null;
    // Add up the scores per kind, so "plate" + "trifle" + "cup" all count for Food.
    const totals = new Map();
    for (const c of list) {
      const k = kindOf(c.categoryName || c.displayName, c.index);
      if (!k) continue;
      const t = totals.get(k.key) || { ...k, score: 0, top: null };
      t.score += c.score;
      if (!t.top) t.top = fold(c.categoryName || c.displayName);
      totals.set(k.key, t);
    }
    const best = [...totals.values()].sort((a, b) => b.score - a.score)[0];
    if (!best || best.score < MIN_SCORE) return null;
    return { kind: best.key, label: best.label, detail: best.top, confidence: Math.round(Math.min(1, best.score) * 100) / 100,
      source: "on-device", at: Date.now(), confirmed: false };
  }

  // Loads the model once; later calls reuse it.
  let enginePromise = null;
  function engine() {
    if (!enginePromise) {
      enginePromise = (async () => {
        const vision = await import(MP + "/vision_bundle.mjs");
        const files = await vision.FilesetResolver.forVisionTasks(MP + "/wasm");
        return vision.ImageClassifier.createFromOptions(files, {
          baseOptions: { modelAssetPath: MODEL, delegate: "CPU" }, maxResults: 5, runningMode: "IMAGE"
        });
      })();
      enginePromise.catch(() => { enginePromise = null; }); // try again next time
    }
    return enginePromise;
  }

  // Resolves a suggestion for a photo (a data: URL), or null. Never throws.
  async function look(dataUrl, { timeout = 60000 } = {}) {
    if (typeof dataUrl !== "string" || !/^data:image\//.test(dataUrl)) return null;
    try {
      const run = (async () => {
        const model = await api.engine();
        const img = new Image();
        img.src = dataUrl;
        await img.decode();
        const out = model.classify(img);
        const cats = out && out.classifications && out.classifications[0] ? out.classifications[0].categories : out;
        return suggest(cats);
      })();
      const late = new Promise((r) => setTimeout(() => r(null), timeout));
      return await Promise.race([run, late]);
    } catch (err) {
      console.warn("[See] couldn't look at the photo:", err && err.message);
      return null;
    }
  }

  // Keeps only what we know how to read.
  function normalize(s) {
    if (!s || typeof s !== "object" || typeof s.kind !== "string") return null;
    const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
    return { kind: str(s.kind, 20), label: str(s.label, 40) || "Something", detail: str(s.detail, 60), confidence: Number.isFinite(s.confidence) ? s.confidence : 0,
      source: str(s.source, 20) || "on-device", at: Number.isFinite(s.at) ? s.at : Date.now(), confirmed: !!s.confirmed };
  }
  // "Looks like food (trifle)"
  function describe(s) {
    if (!s) return "";
    return "Looks like " + s.label.toLowerCase() + (s.detail && s.detail !== s.label.toLowerCase() ? " (" + s.detail + ")" : "");
  }

  const api = { look, suggest, kindOf, normalize, describe, engine };
  window.CPSee = api;
})();
