/* Language Surface — import: detect what a file contains and turn it into a merge plan.
 *
 * Supported inputs
 *   CSV   key,en,ja,…                        (any delimiter; first column is the key)
 *   JSON  { "a.b": { en, ja } }               multi-language, flat keys
 *   JSON  { a: { b: { en, ja } } }            multi-language, nested keys
 *   JSON  { en: { a: { b } }, ja: { … } }     multi-language, language first
 *   JSON  { a: { b: "text" } }                single language (one file per language)
 *   TXT   one line = one string
 */
(function (LS) {
  "use strict";

  const langs = LS.langs;
  const normalizeKey = LS.keys.normalizeKey;
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  function isPrimitive(v) {
    return v === null || v === undefined || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
  }
  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }
  function toText(v) {
    return v === null || v === undefined ? "" : String(v);
  }
  function validKey(key) {
    return !!key && key !== "__proto__";
  }

  /* ------------------------------------------------------------------ JSON */

  /** Remove // and block comments plus trailing commas, without touching string contents. */
  function stripJsonComments(src) {
    let out = "";
    let i = 0;
    const n = src.length;
    let inStr = false;
    while (i < n) {
      const c = src[i];
      if (inStr) {
        out += c;
        if (c === "\\" && i + 1 < n) {
          out += src[i + 1];
          i += 2;
          continue;
        }
        if (c === '"') inStr = false;
        i++;
        continue;
      }
      if (c === '"') {
        inStr = true;
        out += c;
        i++;
        continue;
      }
      if (c === "/" && src[i + 1] === "/") {
        while (i < n && src[i] !== "\n") i++;
        continue;
      }
      if (c === "/" && src[i + 1] === "*") {
        const end = src.indexOf("*/", i + 2);
        i = end === -1 ? n : end + 2;
        continue;
      }
      if (c === ",") {
        let j = i + 1;
        while (j < n && /\s/.test(src[j])) j++;
        if (src[j] === "}" || src[j] === "]") {
          i++;
          continue;
        }
      }
      out += c;
      i++;
    }
    return out;
  }

  /** Strict JSON first, then a JSONC-tolerant retry (comments, trailing commas). */
  function parseJSON(text, label) {
    const src = LS.util.stripBom(String(text == null ? "" : text));
    try {
      return JSON.parse(src);
    } catch (strictError) {
      try {
        return JSON.parse(stripJsonComments(src));
      } catch (e) {
        const detail = String((strictError && strictError.message) || "").replace(/^JSON\.parse:\s*/i, "");
        throw new Error((label ? "Invalid JSON in " + label : "Invalid JSON") + (detail ? " — " + detail : ""));
      }
    }
  }

  /**
   * Find language maps ({en: "…", ja: "…"}) anywhere in a document, arrays included.
   * {lp:{hello:{en:"Hello"}}} -> {"lp.hello": {en:"Hello"}}
   * Also counts the plain values that are not inside any language map.
   */
  function collectLangMaps(obj) {
    const candidates = [];
    let skipped = 0;
    const join = (path, k) => (path ? path + "." + k : k);
    function countPrimitives(node) {
      if (isPrimitive(node)) return 1;
      if (!node || typeof node !== "object") return 0;
      let n = 0;
      for (const k of Object.keys(node)) n += countPrimitives(node[k]);
      return n;
    }
    function walk(node, path) {
      if (isPrimitive(node)) {
        if (path) skipped++;
        return;
      }
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) walk(node[i], path + "[" + i + "]");
        return;
      }
      const keys = Object.keys(node);
      if (path && keys.length && langs.looksLikeLangMapKeys(keys) && keys.every((k) => isPrimitive(node[k]))) {
        candidates.push({ path, node, keys });
        return;
      }
      for (const k of keys) walk(node[k], join(path, k));
    }
    walk(obj, "");

    // Short words such as {yes, no} or {am, pm} look like language codes too. Real language maps
    // repeat the same languages throughout a file, so keep a candidate only when it consists of
    // known languages or shares a language with the bulk of the other candidates.
    const freq = new Map();
    for (const c of candidates) for (const k of c.keys) freq.set(langs.normalize(k), (freq.get(langs.normalize(k)) || 0) + 1);
    const common = new Set();
    for (const [code, n] of freq) if (candidates.length >= 2 && n / candidates.length >= 0.5) common.add(code);
    const maps = Object.create(null);
    let mapCount = 0;
    for (const c of candidates) {
      const codes = c.keys.map(langs.normalize);
      const allKnown = c.keys.every((k) => langs.looksLikeKnownLangBase(k));
      if (allKnown || codes.some((code) => common.has(code))) {
        maps[c.path] = c.node;
        mapCount++;
      } else skipped += countPrimitives(c.node);
    }
    return { maps, skipped, mapCount, candidates: candidates.length };
  }

  /** Flatten nested JSON to dotted keys with primitive leaves; arrays become key[0], key[1], … Nothing is dropped. */
  function flattenValues(obj) {
    const out = Object.create(null);
    function walk(node, path) {
      if (isPrimitive(node)) {
        if (path) out[path] = node;
        return;
      }
      if (typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) walk(node[i], path + "[" + i + "]");
        return;
      }
      for (const k of Object.keys(node)) walk(node[k], path ? path + "." + k : k);
    }
    walk(obj, "");
    return out;
  }

  function entriesFromLangMaps(maps) {
    const entries = Object.create(null);
    const order = [];
    const freq = Object.create(null);
    let count = 0;
    for (const rawKey of Object.keys(maps)) {
      const key = normalizeKey(rawKey);
      if (!validKey(key)) continue;
      const map = maps[rawKey];
      const entry = entries[key] || Object.create(null);
      let any = false;
      for (const rawLang of Object.keys(map)) {
        const lang = langs.normalize(rawLang);
        if (!lang) continue;
        const value = toText(map[rawLang]);
        // A second map for the same key never erases text with an empty value.
        if (value !== "" || typeof entry[lang] !== "string") entry[lang] = value;
        if (!order.includes(lang)) order.push(lang);
        freq[lang] = (freq[lang] || 0) + 1;
        any = true;
      }
      if (any) {
        entries[key] = entry;
        count++;
      }
    }
    return { entries, langs: order, freq, mapCount: count };
  }

  /** Key-first maps: { "a.b": {en, ja} } or nested with language maps at the leaves. */
  function detectKeyFirst(data) {
    if (!data || typeof data !== "object") return null;
    const { maps, skipped } = collectLangMaps(data);
    const res = entriesFromLangMaps(maps);
    if (!Object.keys(res.entries).length || !res.langs.length) return null;
    res.skipped = skipped;
    return res;
  }

  /** Language-first maps: { en: {…}, ja: {…} } whose sub-trees share most of their keys. */
  function detectLangFirst(data, fileLang) {
    if (!isPlainObject(data)) return null;
    const rootKeys = Object.keys(data);
    if (rootKeys.length < 2 || !langs.looksLikeLangMapKeys(rootKeys)) return null;
    if (!rootKeys.every((k) => isPlainObject(data[k]))) return null;
    const known = knownRatio(rootKeys);
    if (known < 0.5) return null;
    // A file named after one language whose top level does not even contain that language is
    // far more likely a single-language file with short namespaces ({am: …, pm: …}).
    if (fileLang && !rootKeys.some((k) => langs.normalize(k) === fileLang) && known < 1) return null;
    const flats = rootKeys.map((k) => flattenValues(data[k]));
    const sizes = flats.map((f) => Object.keys(f).length);
    if (sizes.some((n) => n === 0)) return null;
    // Structural similarity between the first language and each other one.
    const first = flats[0];
    let overlapSum = 0;
    for (let i = 1; i < flats.length; i++) {
      let shared = 0;
      for (const k of Object.keys(flats[i])) if (k in first) shared++;
      overlapSum += shared / Math.min(sizes[0], sizes[i]);
    }
    if (overlapSum / (flats.length - 1) < 0.5) return null;

    const entries = Object.create(null);
    const order = [];
    rootKeys.forEach((rawLang, i) => {
      const lang = langs.normalize(rawLang);
      if (!lang) return;
      if (!order.includes(lang)) order.push(lang);
      for (const rawKey of Object.keys(flats[i])) {
        const key = normalizeKey(rawKey);
        if (!validKey(key)) continue;
        (entries[key] || (entries[key] = Object.create(null)))[lang] = toText(flats[i][rawKey]);
      }
    });
    return { entries, langs: order, skipped: 0, mapCount: Object.keys(entries).length, freq: null };
  }

  function knownRatio(keys) {
    if (!keys.length) return 0;
    return keys.filter((k) => langs.looksLikeKnownLangBase(k)).length / keys.length;
  }

  /** The multi-language reading of a parsed JSON document, or null when there is none. */
  function detectMulti(data, fileLang) {
    const keyFirst = detectKeyFirst(data);
    const langFirst = detectLangFirst(data, fileLang);
    if (keyFirst && langFirst) {
      // Ambiguous (both levels look like languages): prefer the level with more real language codes.
      const outer = knownRatio(Object.keys(data));
      const inner = knownRatio(keyFirst.langs);
      return outer > inner ? Object.assign(langFirst, { layout: "lang-first" }) : Object.assign(keyFirst, { layout: "key-first" });
    }
    if (langFirst) return Object.assign(langFirst, { layout: "lang-first" });
    if (keyFirst) return Object.assign(keyFirst, { layout: "key-first" });
    return null;
  }

  /**
   * Should a JSON file that can be read both ways default to "several languages"?
   * Wrong guesses here used to hide real strings, so the bar is deliberately high: the file has
   * to look like a translation map throughout, not merely contain something map-shaped.
   */
  function preferMulti(multi, single, fileLang) {
    if (!multi) return false;
    if (!single) return true;
    if (multi.layout === "lang-first") return true;
    const mapped = Object.keys(multi.entries).length;
    if (multi.skipped > mapped) return false;
    const allKnown = multi.langs.every((l) => langs.looksLikeKnownLangBase(l));
    if (fileLang) return allKnown && multi.mapCount >= 2 && multi.skipped === 0;
    if (allKnown) return true;
    let dominant = 0;
    for (const l of multi.langs) {
      if (langs.looksLikeKnownLangBase(l)) dominant = Math.max(dominant, (multi.freq[l] || 0) / multi.mapCount);
    }
    return multi.mapCount >= 2 && dominant >= 0.6;
  }

  /** Single-language reading of a JSON document: every string, flattened. */
  function detectSingle(data, fileName, defaultLang) {
    let obj = data;
    let lang = langs.inferFromFileName(fileName);
    let langSource = lang ? "filename" : "";
    // { "en": { … } } wrapper: unwrap when it agrees with (or replaces a missing) file-name language.
    if (isPlainObject(data)) {
      const keys = Object.keys(data);
      if (keys.length === 1 && isPlainObject(data[keys[0]]) && langs.looksLikeLangCode(keys[0]) && langs.looksLikeKnownLangBase(keys[0])) {
        const wrapped = langs.normalize(keys[0]);
        if (!lang || lang === wrapped) {
          obj = data[keys[0]];
          lang = wrapped;
          langSource = "wrapper";
        }
      }
    }
    const flat = flattenValues(obj);
    const values = Object.create(null);
    for (const rawKey of Object.keys(flat)) {
      const key = normalizeKey(rawKey);
      if (validKey(key)) values[key] = toText(flat[rawKey]);
    }
    void defaultLang;
    return { values, lang, langSource };
  }

  /* ------------------------------------------------------------------ analysis */

  function extensionOf(name) {
    const m = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : "";
  }

  function sniffFormat(name, text) {
    const ext = extensionOf(name);
    if (ext === "csv" || ext === "tsv") return "csv";
    if (ext === "json" || ext === "jsonc" || ext === "json5") return "json";
    if (ext === "txt" || ext === "text") return "text";
    const head = LS.util.stripBom(String(text || "")).trimStart().slice(0, 1);
    if (head === "{" || head === "[") return "json";
    const firstLine = String(text || "").split(/\r?\n/, 1)[0] || "";
    if (/^\s*"?(key|keys|id)"?\s*[,;\t|]/i.test(firstLine)) return "csv";
    return "text";
  }

  /**
   * Inspect one file.
   * @param {{name: string, text: string, size?: number}} file
   * @param {{defaultLang?: string}} [ctx]
   * @returns {Object} source descriptor (see module header); `error` is set when unusable.
   */
  function analyzeFile(file, ctx) {
    const defaultLang = langs.normalize((ctx && ctx.defaultLang) || "en") || "en";
    const name = String(file.name || "file");
    const text = String(file.text == null ? "" : file.text);
    const source = {
      id: LS.util.uid("src"),
      name,
      size: file.size != null ? file.size : text.length,
      format: sniffFormat(name, text),
      kind: "",
      error: "",
      notes: [],
      keyCount: 0,
    };

    try {
      if (source.format === "csv") analyzeCSV(source, text);
      else if (source.format === "json") analyzeJSON(source, text, defaultLang);
      else analyzeText(source, text, defaultLang);
    } catch (e) {
      source.error = (e && e.message) || String(e);
    }
    return source;
  }

  function analyzeCSV(source, text) {
    const { rows, delimiter } = LS.csv.parse(text);
    if (rows.length < 2) throw new Error("CSV needs a header row and at least one data row.");
    const header = rows[0].map((h) => String(h).trim());
    if (header.length < 2) throw new Error("CSV needs a key column followed by at least one language column.");
    const cols = [];
    const order = [];
    for (let c = 1; c < header.length; c++) {
      const lang = langs.normalize(header[c]);
      cols.push(lang);
      if (!lang) {
        if (header[c]) source.notes.push('Column "' + header[c] + '" is not a usable language code and was skipped.');
        continue;
      }
      if (order.includes(lang)) source.notes.push("Column " + lang.toUpperCase() + " appears more than once; filled cells from the later column win.");
      else order.push(lang);
    }
    if (!order.length) throw new Error("CSV has no language columns (expected a header like: key,en,ja).");
    if (!/^(key|keys|id|name|identifier)$/i.test(header[0])) {
      source.notes.push('Using the first column ("' + (header[0] || "unnamed") + '") as the key.');
    }
    const entries = Object.create(null);
    let noKey = 0;
    let repeated = 0;
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const key = normalizeKey(row[0]);
      if (!validKey(key)) {
        noKey++;
        continue;
      }
      let entry = entries[key];
      if (entry) repeated++;
      else entry = entries[key] = Object.create(null);
      for (let c = 1; c < header.length; c++) {
        const lang = cols[c - 1];
        if (!lang) continue;
        const value = toText(row[c]);
        // When a key or column repeats, an empty cell never erases text found earlier.
        if (value !== "" || typeof entry[lang] !== "string") entry[lang] = value;
      }
    }
    if (noKey) source.notes.push(LS.util.plural(noKey, "row") + " without a key " + (noKey === 1 ? "was" : "were") + " skipped.");
    if (repeated) source.notes.push(LS.util.plural(repeated, "row") + " repeat" + (repeated === 1 ? "s" : "") + " an earlier key; their filled cells were merged into it.");
    source.kind = "multi";
    source.layout = "csv";
    source.delimiter = delimiter;
    source.langs = order;
    source.entries = entries;
    source.keyCount = Object.keys(entries).length;
    if (!source.keyCount) throw new Error("CSV has no rows with a key.");
  }

  function analyzeJSON(source, text, defaultLang) {
    const data = parseJSON(text, source.name);
    if (!data || typeof data !== "object") throw new Error("JSON root must be an object.");
    const single = detectSingle(data, source.name, defaultLang);
    const fileLang = single.langSource === "filename" ? single.lang : "";
    const multi = detectMulti(data, fileLang);
    source.multi = multi;
    source.single = Object.keys(single.values).length ? single : null;
    if (!multi && !source.single) throw new Error("No translatable strings found in this JSON file.");
    setJSONKind(source, preferMulti(multi, source.single, fileLang) ? "multi" : "single", defaultLang);
  }

  /** Apply (or switch) the interpretation of a JSON source: "multi" | "single". */
  function setJSONKind(source, kind, defaultLang) {
    if (source.format !== "json") return source;
    if (kind === "multi" && source.multi) {
      source.kind = "multi";
      source.layout = source.multi.layout;
      source.langs = source.multi.langs.slice();
      source.entries = source.multi.entries;
      source.keyCount = Object.keys(source.entries).length;
      source.notes = source.multi.skipped
        ? [
            LS.util.plural(source.multi.skipped, "value") +
              " " +
              (source.multi.skipped === 1 ? "is" : "are") +
              " not inside a language map and will not be imported. Read the file as one language to keep everything.",
          ]
        : [];
    } else if (source.single) {
      source.kind = "single";
      source.layout = "single";
      source.values = source.single.values;
      if (source.lang === undefined) {
        source.lang = source.single.lang || langs.normalize(defaultLang) || "en";
        source.langSource = source.single.langSource || "default";
      }
      source.keyCount = Object.keys(source.values).length;
      source.notes = [];
    }
    return source;
  }

  function analyzeText(source, text, defaultLang) {
    // Keys follow line numbers, so that en.txt and ja.txt stay aligned even when one of them
    // has an empty line. Blank lines themselves produce no key.
    const raw = LS.util.stripBom(text).split(/\r\n|\r|\n/);
    const items = [];
    let blanksInside = 0;
    let pendingBlanks = 0;
    raw.forEach((line, i) => {
      const value = line.trim();
      if (!value) {
        pendingBlanks++;
        return;
      }
      if (items.length) blanksInside += pendingBlanks;
      pendingBlanks = 0;
      items.push({ n: i + 1, text: value });
    });
    if (!items.length) throw new Error("The file is empty.");
    const fileLang = langs.inferFromFileName(source.name);
    source.format = "text";
    source.kind = "lines";
    source.layout = "lines";
    source.items = items;
    source.lines = items.map((it) => it.text);
    source.lang = fileLang || defaultLang;
    source.langSource = fileLang ? "filename" : "default";
    source.prefix = "";
    source.keyCount = items.length;
    if (blanksInside) source.notes.push(LS.util.plural(blanksInside, "empty line") + " skipped. Keys follow line numbers, so files for other languages stay aligned.");
  }

  /** Key used for line `index` (0-based) of a text import. */
  function lineKey(prefix, index) {
    const p = normalizeKey(prefix);
    return p ? p + "_" + (index + 1) : String(index + 1);
  }

  /* ------------------------------------------------------------------ plan */

  /**
   * Merge analyzed sources into one plan.
   * @returns {{entries: Object, langs: string[], problems: string[], keyCount: number}}
   */
  function buildPlan(sources) {
    const entries = Object.create(null);
    const order = [];
    const problems = [];
    const addLang = (l) => {
      if (l && !order.includes(l)) order.push(l);
    };
    const put = (key, lang, value) => {
      const entry = entries[key] || (entries[key] = Object.create(null));
      // Across several files, an empty value never erases text another file provided.
      if (value !== "" || typeof entry[lang] !== "string") entry[lang] = value;
    };

    for (const src of sources) {
      if (src.error) continue;
      if (src.kind === "multi") {
        src.langs.forEach(addLang);
        for (const key of Object.keys(src.entries)) {
          const entry = src.entries[key];
          if (!entries[key]) entries[key] = Object.create(null);
          for (const lang of Object.keys(entry)) put(key, lang, entry[lang]);
        }
      } else if (src.kind === "single" || src.kind === "lines") {
        const lang = langs.normalize(src.lang);
        if (!lang) {
          problems.push("Choose a language for " + src.name + ".");
          continue;
        }
        addLang(lang);
        if (src.kind === "single") {
          for (const key of Object.keys(src.values)) put(key, lang, src.values[key]);
        } else {
          for (const item of src.items) {
            const key = lineKey(src.prefix, item.n - 1);
            if (validKey(key)) put(key, lang, item.text);
          }
        }
      }
    }
    return { entries, langs: order, problems, keyCount: Object.keys(entries).length };
  }

  /**
   * What would applying `plan` to `project` change?
   * mode "overwrite": incoming non-empty values replace existing ones.
   * mode "keep":      only empty cells are filled.
   * Empty incoming values never erase existing translations.
   */
  function summarize(project, plan, mode) {
    const stats = { newKeys: 0, existingKeys: 0, newLangs: [], filled: 0, replaced: 0, kept: 0, unchanged: 0 };
    const have = project ? project.entries : Object.create(null);
    const projectLangs = project ? project.languages : [];
    stats.newLangs = plan.langs.filter((l) => !projectLangs.includes(l));
    for (const key of Object.keys(plan.entries)) {
      const incoming = plan.entries[key];
      const current = hasOwn(have, key) ? have[key] : null;
      if (!current) stats.newKeys++;
      else stats.existingKeys++;
      for (const lang of Object.keys(incoming)) {
        const next = incoming[lang];
        if (next === "") continue;
        const prev = current && typeof current[lang] === "string" ? current[lang] : "";
        if (prev === "") stats.filled++;
        else if (prev === next) stats.unchanged++;
        else if (mode === "keep") stats.kept++;
        else stats.replaced++;
      }
    }
    return stats;
  }

  /**
   * Cell changes needed to apply `plan` to `project` (used by the store as one undoable step).
   * @returns {{addKeys: string[], addLangs: string[], changes: {key, lang, value}[]}}
   */
  function planChanges(project, plan, mode) {
    const addKeys = [];
    const changes = [];
    const addLangs = plan.langs.filter((l) => !project.languages.includes(l));
    for (const key of Object.keys(plan.entries)) {
      const incoming = plan.entries[key];
      const current = hasOwn(project.entries, key) ? project.entries[key] : null;
      if (!current) addKeys.push(key);
      for (const lang of Object.keys(incoming)) {
        const next = incoming[lang];
        if (next === "") continue;
        const prev = current && typeof current[lang] === "string" ? current[lang] : "";
        if (prev === next) continue;
        if (prev !== "" && mode === "keep") continue;
        changes.push({ key, lang, value: next });
      }
    }
    return { addKeys, addLangs, changes };
  }

  LS.importer = {
    parseJSON,
    stripJsonComments,
    analyzeFile,
    setJSONKind,
    lineKey,
    buildPlan,
    summarize,
    planChanges,
    // exposed for tests
    detectMulti,
    detectSingle,
    preferMulti,
    flattenValues,
  };
})(globalThis.LS || (globalThis.LS = {}));
