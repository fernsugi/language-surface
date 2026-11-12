/* Language Surface — project model and invertible operations.
 *
 * Every change to a project is expressed as a small "op". Applying an op returns the op that
 * undoes it, which is what makes undo/redo exact and cheap. This file is pure (no DOM, no storage).
 *
 * Project shape
 *   { id, name, languages: [code], sourceLang, entries: { key: { lang: text } },
 *     glossary: [{ id, sourceLang, targetLang, from, to }], pinned: [key], context, meta }
 */
(function (LS) {
  "use strict";

  const { uid } = LS.util;
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  /** Null-prototype map so keys like "constructor" or "__proto__" behave as plain data. */
  function dict(source) {
    const out = Object.create(null);
    if (source) for (const k of Object.keys(source)) out[k] = source[k];
    return out;
  }

  function newEntry(values) {
    const e = Object.create(null);
    if (values) {
      for (const lang of Object.keys(values)) {
        if (typeof values[lang] === "string") e[lang] = values[lang];
        else if (values[lang] != null) e[lang] = String(values[lang]);
      }
    }
    return e;
  }

  /** Translation text for a cell ("" when missing). */
  function getValue(project, key, lang) {
    const entry = project.entries[key];
    const v = entry ? entry[lang] : undefined;
    return typeof v === "string" ? v : "";
  }

  function hasKey(project, key) {
    return has(project.entries, key);
  }

  function createProject(init) {
    const o = init || {};
    const now = Date.now();
    return normalizeProject({
      id: o.id || uid("p"),
      name: o.name || "Untitled project",
      languages: o.languages && o.languages.length ? o.languages.slice() : ["en"],
      sourceLang: o.sourceLang,
      entries: o.entries || {},
      glossary: o.glossary || [],
      pinned: o.pinned || [],
      context: o.context || "",
      meta: { createdAt: now, updatedAt: now },
    });
  }

  /** Coerce stored/imported data into a well-formed project (never throws). */
  function normalizeProject(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const languages = LS.util.uniq((Array.isArray(r.languages) ? r.languages : []).map(LS.langs.normalize).filter(Boolean));
    if (!languages.length) languages.push("en");

    // Language codes inside entries are stored in canonical form. Hand-edited backups may use
    // "pt_BR" or "EN"; remap those (only when needed: this runs on every load).
    const rawLangs = Array.isArray(r.languages) ? r.languages : [];
    const remap = rawLangs.some((l) => typeof l !== "string" || l !== LS.langs.normalize(l));
    const entries = Object.create(null);
    const src = r.entries && typeof r.entries === "object" ? r.entries : {};
    for (const key of Object.keys(src)) {
      const value = src[key];
      const entry = newEntry(value && typeof value === "object" ? value : null);
      if (remap) {
        for (const code of Object.keys(entry)) {
          const norm = LS.langs.normalize(code);
          if (norm && norm !== code) {
            if (entry[norm] === undefined || entry[norm] === "") entry[norm] = entry[code];
            delete entry[code];
          }
        }
      }
      entries[key] = entry;
    }

    const glossary = (Array.isArray(r.glossary) ? r.glossary : [])
      .filter((g) => g && typeof g.from === "string" && typeof g.to === "string" && g.from && g.to)
      .map((g) => ({
        id: g.id || uid("g"),
        sourceLang: LS.langs.normalize(g.sourceLang) || "all",
        targetLang: LS.langs.normalize(g.targetLang) || "all",
        from: g.from,
        to: g.to,
      }));

    const sourceLang = languages.includes(LS.langs.normalize(r.sourceLang)) ? LS.langs.normalize(r.sourceLang) : languages[0];
    const meta = r.meta && typeof r.meta === "object" ? r.meta : {};
    const now = Date.now();
    return {
      id: String(r.id || uid("p")),
      name: String(r.name || "Untitled project"),
      languages,
      sourceLang,
      entries,
      glossary,
      pinned: LS.util.uniq((Array.isArray(r.pinned) ? r.pinned : []).filter((k) => typeof k === "string" && has(entries, k))),
      context: typeof r.context === "string" ? r.context : "",
      meta: { createdAt: Number(meta.createdAt) || now, updatedAt: Number(meta.updatedAt) || now },
    };
  }

  /** Deep copy of a project under a new id. */
  function cloneProject(project, name) {
    const copy = normalizeProject(JSON.parse(JSON.stringify(project)));
    copy.id = uid("p");
    copy.name = name || project.name + " (copy)";
    copy.glossary = copy.glossary.map((g) => Object.assign({}, g, { id: uid("g") }));
    copy.meta = { createdAt: Date.now(), updatedAt: Date.now() };
    return copy;
  }

  /* ---- Ops ------------------------------------------------------------------ */

  /** Rebuild `entries` in a given key order (objects keep insertion order). */
  function reorder(project, order, source) {
    const next = Object.create(null);
    for (const k of order) next[k] = source[k];
    project.entries = next;
  }

  /**
   * Apply one op to a project and return its inverse (or null when nothing changed).
   *
   *   { t: "set", key, lang, value }            value undefined removes the cell
   *   { t: "addKeys", items: [{ key, entry, index? }] }
   *   { t: "delKeys", keys: [key] }
   *   { t: "renKey", from, to }
   *   { t: "addLang", lang, index?, values? }
   *   { t: "delLang", lang }
   *   { t: "renLang", from, to }
   *   { t: "field", field, value }              name | sourceLang | context | pinned | glossary | languages
   */
  function applyOp(project, op) {
    switch (op.t) {
      case "set": {
        const entry = project.entries[op.key];
        if (!entry) return null;
        const prev = typeof entry[op.lang] === "string" ? entry[op.lang] : undefined;
        if (prev === op.value) return null;
        if (op.value === undefined) delete entry[op.lang];
        else entry[op.lang] = op.value;
        return { t: "set", key: op.key, lang: op.lang, value: prev };
      }

      case "addKeys": {
        const items = op.items.filter((it) => it && it.key && !has(project.entries, it.key));
        if (!items.length) return null;
        const positioned = items.filter((it) => Number.isInteger(it.index));
        if (!positioned.length) {
          for (const it of items) project.entries[it.key] = it.entry || newEntry();
        } else {
          // Merge new keys back into their original positions.
          const existing = Object.keys(project.entries);
          const source = dict(project.entries);
          const byIndex = new Map();
          const tail = [];
          for (const it of items) {
            source[it.key] = it.entry || newEntry();
            if (Number.isInteger(it.index) && !byIndex.has(it.index)) byIndex.set(it.index, it.key);
            else tail.push(it.key);
          }
          const order = [];
          const placed = new Set();
          let e = 0;
          const total = existing.length + byIndex.size;
          for (let i = 0; i < total; i++) {
            if (byIndex.has(i)) {
              order.push(byIndex.get(i));
              placed.add(i);
            } else if (e < existing.length) order.push(existing[e++]);
          }
          while (e < existing.length) order.push(existing[e++]);
          for (const [index, k] of byIndex) if (!placed.has(index)) order.push(k);
          reorder(project, order.concat(tail), source);
        }
        return { t: "delKeys", keys: items.map((it) => it.key) };
      }

      case "delKeys": {
        const doomed = new Set(op.keys.filter((k) => has(project.entries, k)));
        if (!doomed.size) return null;
        const items = [];
        const keep = [];
        const all = Object.keys(project.entries);
        for (let i = 0; i < all.length; i++) {
          const k = all[i];
          if (doomed.has(k)) items.push({ key: k, entry: project.entries[k], index: i });
          else keep.push(k);
        }
        reorder(project, keep, project.entries);
        return { t: "addKeys", items };
      }

      case "renKey": {
        if (!has(project.entries, op.from) || has(project.entries, op.to) || op.from === op.to) return null;
        const source = project.entries;
        const next = Object.create(null);
        for (const k of Object.keys(source)) next[k === op.from ? op.to : k] = source[k];
        project.entries = next;
        if (project.pinned.includes(op.from)) project.pinned = project.pinned.map((k) => (k === op.from ? op.to : k));
        return { t: "renKey", from: op.to, to: op.from };
      }

      case "addLang": {
        if (!op.lang || project.languages.includes(op.lang)) return null;
        const languages = project.languages.slice();
        const index = Number.isInteger(op.index) ? LS.util.clamp(op.index, 0, languages.length) : languages.length;
        languages.splice(index, 0, op.lang);
        project.languages = languages;
        if (op.values) {
          for (const key of Object.keys(op.values)) {
            const entry = project.entries[key];
            if (entry) entry[op.lang] = op.values[key];
          }
        }
        return { t: "delLang", lang: op.lang };
      }

      case "delLang": {
        const index = project.languages.indexOf(op.lang);
        if (index === -1) return null;
        project.languages = project.languages.filter((l) => l !== op.lang);
        const values = Object.create(null);
        for (const key of Object.keys(project.entries)) {
          const entry = project.entries[key];
          if (typeof entry[op.lang] === "string") values[key] = entry[op.lang];
          delete entry[op.lang];
        }
        return { t: "addLang", lang: op.lang, index, values };
      }

      case "renLang": {
        if (!project.languages.includes(op.from) || project.languages.includes(op.to) || !op.to) return null;
        project.languages = project.languages.map((l) => (l === op.from ? op.to : l));
        if (project.sourceLang === op.from) project.sourceLang = op.to;
        for (const key of Object.keys(project.entries)) {
          const entry = project.entries[key];
          if (typeof entry[op.from] === "string") entry[op.to] = entry[op.from];
          else delete entry[op.to];
          delete entry[op.from];
        }
        return { t: "renLang", from: op.to, to: op.from };
      }

      case "field": {
        const prev = project[op.field];
        if (prev === op.value) return null;
        project[op.field] = op.value;
        return { t: "field", field: op.field, value: prev };
      }

      default:
        throw new Error("Unknown op: " + op.t);
    }
  }

  /**
   * Apply ops in order. Returns the inverse ops, already ordered so that applying them
   * in sequence restores the previous state.
   */
  function applyOps(project, ops) {
    const inverse = [];
    for (const op of ops) {
      const inv = applyOp(project, op);
      if (inv) inverse.push(inv);
    }
    return inverse.reverse();
  }

  /** What kind of UI refresh do these ops require? */
  function describeOps(ops) {
    let structural = false;
    let cells = 0;
    let meta = false;
    let last = null;
    for (const op of ops) {
      if (op.t === "set") {
        cells++;
        last = op;
      } else if (op.t === "field") meta = true;
      else structural = true;
    }
    return { structural, cells, meta, single: !structural && !meta && cells === 1 ? last : null };
  }

  /**
   * Apply this tab's not-yet-saved cell edits on top of another tab's version of the project.
   * @param {Object} remote project as just read from storage (modified in place and returned)
   * @param {Object} local  the in-memory project holding the unsaved edits
   * @param {Iterable<string>} cellIds "key\u0000lang" identifiers of the edited cells
   */
  function mergeUnsavedCells(remote, local, cellIds) {
    for (const id of cellIds) {
      const i = id.indexOf("\u0000");
      const key = id.slice(0, i);
      const lang = id.slice(i + 1);
      if (!has(remote.entries, key) || !has(local.entries, key) || !remote.languages.includes(lang)) continue;
      const value = local.entries[key][lang];
      if (typeof value === "string") remote.entries[key][lang] = value;
      else delete remote.entries[key][lang];
    }
    return remote;
  }

  /* ---- Stats ---------------------------------------------------------------- */

  /** @returns {{total: number, filled: Object<string, number>, complete: number}} */
  function computeStats(project) {
    const langs = project.languages;
    const filled = Object.create(null);
    for (const l of langs) filled[l] = 0;
    let total = 0;
    let complete = 0;
    const entries = project.entries;
    for (const key in entries) {
      total++;
      const entry = entries[key];
      let all = true;
      for (let i = 0; i < langs.length; i++) {
        const v = entry[langs[i]];
        if (typeof v === "string" && v !== "") filled[langs[i]]++;
        else all = false;
      }
      if (all) complete++;
    }
    return { total, filled, complete };
  }

  /* ---- Sample data ------------------------------------------------------------ */

  function sampleProject() {
    const rows = [
      ["app.tagline", "Translate your product without leaving the browser.", "ブラウザだけで、プロダクトを翻訳しよう。", "Traduisez votre produit sans quitter le navigateur.", ""],
      ["nav.home", "Home", "ホーム", "Accueil", "Startseite"],
      ["nav.projects", "Projects", "プロジェクト", "Projets", "Projekte"],
      ["nav.settings", "Settings", "設定", "Paramètres", "Einstellungen"],
      ["nav.help", "Help", "ヘルプ", "Aide", ""],
      ["auth.login.title", "Welcome back", "おかえりなさい", "Bon retour", "Willkommen zurück"],
      ["auth.login.email", "Email address", "メールアドレス", "Adresse e-mail", ""],
      ["auth.login.password", "Password", "パスワード", "Mot de passe", "Passwort"],
      ["auth.login.submit", "Sign in", "ログイン", "Se connecter", "Anmelden"],
      ["auth.login.forgot", "Forgot your password?", "パスワードをお忘れですか？", "Mot de passe oublié ?", ""],
      ["auth.signup.title", "Create your account", "アカウントを作成", "Créez votre compte", ""],
      ["auth.signup.terms", "By continuing you agree to our <a>Terms</a>.", "続行すると<a>利用規約</a>に同意したことになります。", "En continuant, vous acceptez nos <a>Conditions</a>.", ""],
      ["home.greeting", "Hello, {name}!", "こんにちは、{name}さん！", "Bonjour, {name} !", "Hallo, {name}!"],
      ["home.summary", "You have {count} unread messages.", "未読メッセージが{count}件あります。", "Vous avez des messages non lus.", ""],
      ["cart.title", "Your cart", "カート", "Votre panier", ""],
      ["cart.empty", "Your cart is empty.", "カートは空です。", "Votre panier est vide.", ""],
      ["cart.items", "{count} items", "{count}点", "{count} articles", ""],
      ["cart.checkout", "Checkout", "レジに進む", "", ""],
      ["cart.total", "Total: {amount}", "合計：{amount}", "Total : {amount}", ""],
      ["errors.network", "Something went wrong.\nPlease check your connection and try again.", "問題が発生しました。\n接続を確認して、もう一度お試しください。", "", ""],
      ["errors.notFound", "We couldn't find that page.", "ページが見つかりませんでした。", "Page introuvable.", ""],
      ["errors.required", "This field is required.", "この項目は必須です。", "Ce champ est obligatoire.", "Dieses Feld ist erforderlich."],
      ["settings.language", "Language", "言語", "Langue", "Sprache"],
      ["settings.theme", "Theme", "テーマ", "Thème", ""],
      ["settings.notifications", "Notifications", "", "Notifications", "Benachrichtigungen"],
      ["settings.save", "Save changes", "変更を保存", "Enregistrer", ""],
    ];
    const entries = {};
    for (const [key, en, ja, fr, de] of rows) entries[key] = { en, ja, fr, de };
    return createProject({
      name: "Sample app",
      languages: ["en", "ja", "fr", "de"],
      sourceLang: "en",
      entries,
      glossary: [
        { sourceLang: "en", targetLang: "ja", from: "cart", to: "カート" },
        { sourceLang: "en", targetLang: "fr", from: "cart", to: "panier" },
        { sourceLang: "all", targetLang: "all", from: "Language Surface", to: "Language Surface" },
      ],
      context: "A friendly consumer shopping app. Keep interface text short and natural.",
    });
  }

  LS.ops = {
    dict,
    newEntry,
    getValue,
    hasKey,
    createProject,
    normalizeProject,
    cloneProject,
    applyOp,
    applyOps,
    describeOps,
    mergeUnsavedCells,
    computeStats,
    sampleProject,
  };
})(globalThis.LS || (globalThis.LS = {}));
