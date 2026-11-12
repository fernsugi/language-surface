/* Language Surface — state defaults, normalization and migration from the original app (v1). */
(function (LS) {
  "use strict";

  const LEGACY_KEY = "language_surface_v1"; // localStorage key used by the first version of the app
  const VERSION = 2;

  function defaultSettings() {
    return {
      theme: "system", // "system" | "light" | "dark"
      density: "compact", // "compact" | "comfortable" | "tall"
      confirmDeletes: true,
      ai: {
        provider: "openai",
        providers: {
          openai: { apiKey: "", model: "gpt-4o-mini" },
          anthropic: { apiKey: "", model: "claude-opus-5-5" },
          zai: { apiKey: "", model: "glm-4.5" },
          custom: { apiKey: "", model: "", baseUrl: "" },
        },
        maxChars: 0,
        concurrency: 3,
      },
    };
  }

  function defaultUI() {
    return {
      selectedProjectId: null,
      seenWelcome: false,
      sidebarCollapsed: false,
      inspectorOpen: false,
      views: {},
      exportOptions: {},
    };
  }

  /** Per-project view state (columns, sorting, filters). */
  function defaultView(project) {
    const langs = project ? project.languages : [];
    let visible = langs.slice();
    if (visible.length > 6) {
      const src = project.sourceLang;
      visible = [src].concat(langs.filter((l) => l !== src)).slice(0, 6);
      visible = langs.filter((l) => visible.includes(l));
    }
    return {
      visibleLangs: visible,
      sortBy: "key", // "key" | "lang:<code>"
      sortDir: "asc",
      colWidths: {},
      keyWidth: 250,
      search: "",
      searchIn: "all", // "all" | "keys" | "text"
      status: "all", // "all" | "missing" | "issues" | "pinned"
      namespace: "",
    };
  }

  function isObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function normalizeSettings(raw) {
    const d = defaultSettings();
    const r = isObject(raw) ? raw : {};
    const out = d;
    if (["system", "light", "dark"].includes(r.theme)) out.theme = r.theme;
    if (["compact", "comfortable", "tall"].includes(r.density)) out.density = r.density;
    out.confirmDeletes = r.confirmDeletes !== false;
    const ai = isObject(r.ai) ? r.ai : {};
    if (ai.provider && LS.ai.PROVIDERS[ai.provider]) out.ai.provider = ai.provider;
    const providers = isObject(ai.providers) ? ai.providers : {};
    for (const id of Object.keys(out.ai.providers)) {
      const saved = isObject(providers[id]) ? providers[id] : {};
      for (const field of Object.keys(out.ai.providers[id])) {
        if (typeof saved[field] === "string") out.ai.providers[id][field] = saved[field];
      }
    }
    out.ai.maxChars = Math.max(0, Math.floor(Number(ai.maxChars) || 0));
    out.ai.concurrency = LS.util.clamp(Math.floor(Number(ai.concurrency) || 3), 1, 8);
    return out;
  }

  function normalizeView(raw, project) {
    const d = defaultView(project);
    const r = isObject(raw) ? raw : {};
    const out = d;
    if (Array.isArray(r.visibleLangs)) {
      const vis = project.languages.filter((l) => r.visibleLangs.includes(l));
      if (vis.length) out.visibleLangs = vis;
    }
    if (typeof r.sortBy === "string" && (r.sortBy === "key" || project.languages.includes(r.sortBy.replace(/^lang:/, "")))) {
      out.sortBy = r.sortBy;
    }
    if (r.sortDir === "desc") out.sortDir = "desc";
    if (isObject(r.colWidths)) {
      for (const l of project.languages) {
        const w = Number(r.colWidths[l]);
        if (w >= 120 && w <= 1200) out.colWidths[l] = Math.round(w);
      }
    }
    const kw = Number(r.keyWidth);
    if (kw >= 140 && kw <= 800) out.keyWidth = Math.round(kw);
    if (["all", "keys", "text"].includes(r.searchIn)) out.searchIn = r.searchIn;
    // Filters (search, status, namespace) deliberately start fresh on every load so that
    // nobody comes back to a list that silently hides most of their keys.
    return out;
  }

  function normalizeUI(raw, projects) {
    const d = defaultUI();
    const r = isObject(raw) ? raw : {};
    const ids = Object.keys(projects);
    d.selectedProjectId = ids.includes(r.selectedProjectId) ? r.selectedProjectId : ids[0] || null;
    d.seenWelcome = !!r.seenWelcome;
    d.sidebarCollapsed = !!r.sidebarCollapsed;
    d.inspectorOpen = !!r.inspectorOpen;
    const views = isObject(r.views) ? r.views : {};
    for (const id of ids) d.views[id] = normalizeView(views[id], projects[id]);
    if (isObject(r.exportOptions)) d.exportOptions = r.exportOptions;
    return d;
  }

  /** Build a consistent state object from whatever was stored. */
  function normalizeState(raw) {
    const r = isObject(raw) ? raw : {};
    const projects = {};
    const src = isObject(r.projects) ? r.projects : {};
    for (const id of Object.keys(src)) {
      const p = LS.ops.normalizeProject(Object.assign({}, src[id], { id: (src[id] && src[id].id) || id }));
      projects[p.id] = p;
    }
    return {
      version: VERSION,
      settings: normalizeSettings(r.settings),
      ui: normalizeUI(r.ui, projects),
      projects,
    };
  }

  function emptyState() {
    return normalizeState({});
  }

  /** True when v1 data is just the untouched starter project (nothing worth migrating). */
  function isPristineV1(v1) {
    const ui = v1.ui || {};
    if (ui.seenWelcome) return false;
    const list = Object.values(v1.projects || {});
    if (list.length !== 1) return false;
    const p = list[0] || {};
    const keys = Object.keys(p.entries || {});
    return p.name === "Default Project" && keys.length === 2 && keys.includes("lp.hello") && keys.includes("lp.bye");
  }

  /**
   * Convert state saved by the original app into the current shape.
   * @param {Object} v1 parsed JSON from localStorage["language_surface_v1"]
   * @returns {Object|null} normalized state, or null when there is nothing to migrate
   */
  function fromV1(v1) {
    if (!isObject(v1) || !isObject(v1.projects) || !Object.keys(v1.projects).length) return null;
    if (isPristineV1(v1)) return null;
    const s = isObject(v1.settings) ? v1.settings : {};
    const ui = isObject(v1.ui) ? v1.ui : {};
    const sourcePref = LS.langs.normalize(s.defaultSourceLang || "");
    const locked = Array.isArray(ui.lockedKeys) ? ui.lockedKeys : [];

    const projects = {};
    for (const id of Object.keys(v1.projects)) {
      const p = v1.projects[id];
      if (!isObject(p)) continue;
      const entries = isObject(p.entries) ? p.entries : {};
      projects[id] = {
        id: p.id || id,
        name: p.name,
        languages: p.languages,
        sourceLang: sourcePref,
        entries,
        glossary: (Array.isArray(p.translationRules) ? p.translationRules : []).map((r) => ({
          sourceLang: (r && r.sourceLang) || "all",
          targetLang: (r && r.targetLang) || "all",
          from: r && r.from,
          to: r && r.to,
        })),
        pinned: locked.filter((k) => Object.prototype.hasOwnProperty.call(entries, k)),
        context: typeof s.aiContext === "string" ? s.aiContext : "",
        meta: p.meta,
      };
    }

    const views = {};
    const selected = ui.selectedProjectId;
    if (selected && projects[selected]) {
      views[selected] = { sortBy: ui.listSortBy, sortDir: ui.listSortDir };
    }

    return normalizeState({
      settings: {
        theme: s.theme === "light" ? "light" : "dark",
        density: s.cellDisplay === "wrap" ? "tall" : "compact",
        confirmDeletes: s.confirmDeletes !== false,
        ai: {
          provider: s.aiProvider === "zai" ? "zai" : "openai",
          providers: {
            openai: { apiKey: s.openaiApiKey || "", model: s.openaiModel || "gpt-4o-mini" },
            zai: { apiKey: s.zaiApiKey || "", model: s.zaiModel || "glm-4.5" },
          },
          maxChars: s.defaultMaxChars,
        },
      },
      ui: { selectedProjectId: selected, seenWelcome: true, views },
      projects,
    });
  }

  LS.migrate = {
    LEGACY_KEY,
    VERSION,
    defaultSettings,
    defaultUI,
    defaultView,
    normalizeSettings,
    normalizeView,
    normalizeUI,
    normalizeState,
    emptyState,
    fromV1,
  };
})(globalThis.LS || (globalThis.LS = {}));
