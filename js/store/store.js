/* Language Surface — application store.
 *
 * Holds the in-memory state, turns user intents into invertible ops (undo/redo), notifies the UI,
 * and writes changes behind to local storage. All data stays in this browser.
 *
 * Events (subscribe with store.on(type, fn)):
 *   "settings"  { path }
 *   "ui"        { keys }
 *   "view"      { keys }                 per-project view state (columns, sort, filters)
 *   "projects"  { reason }               project list or current project changed
 *   "project"   { fields }               current project's metadata (name, languages, glossary, pins …)
 *   "entries"   { kind, key?, lang? }    kind: "cell" | "bulk" | "structure"
 *   "history"   {}                       undo/redo availability
 *   "save"      { status, error? }       "saved" | "saving" | "error"
 */
(function (LS) {
  "use strict";

  const { ops, migrate, db, util, langs } = LS;
  const HISTORY_LIMIT = 100;
  let historySeq = 0;
  const COALESCE_MS = 3000;
  const THEME_MIRROR_KEY = "language-surface:theme";

  let state = migrate.emptyState();
  let flags = {};
  const listeners = new Map();
  const histories = new Map(); // projectId -> { undo: [], redo: [] }
  const revs = new Map(); // projectId -> number
  const statsCache = new Map(); // projectId -> { rev, stats }

  const dirty = { settings: false, ui: false, flags: false, projects: new Set(), deleted: new Set() };
  let saveStatus = "saved";
  let saving = false;
  let channel = null;
  const tabId = util.uid("tab");

  /* ---- Events ---------------------------------------------------------------- */

  function on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => off(type, fn);
  }
  function off(type, fn) {
    const set = listeners.get(type);
    if (set) set.delete(fn);
  }
  function emit(type, payload) {
    const data = payload || {};
    const set = listeners.get(type);
    if (set) for (const fn of Array.from(set)) safeCall(fn, data, type);
    const any = listeners.get("*");
    if (any) for (const fn of Array.from(any)) safeCall(fn, data, type);
  }
  function safeCall(fn, data, type) {
    try {
      fn(data, type);
    } catch (e) {
      console.error("Listener for '" + type + "' failed:", e);
    }
  }

  /* ---- Selectors -------------------------------------------------------------- */

  function project(id) {
    return state.projects[id || state.ui.selectedProjectId] || null;
  }

  function projectList() {
    return Object.values(state.projects).sort((a, b) => util.textCompare(a.name, b.name));
  }

  /** Per-project view state (always present for an existing project). */
  function view(id) {
    const p = project(id);
    if (!p) return migrate.defaultView(null);
    if (!state.ui.views[p.id]) state.ui.views[p.id] = migrate.defaultView(p);
    return state.ui.views[p.id];
  }

  function rev(id) {
    return revs.get(id) || 0;
  }
  function bump(id) {
    revs.set(id, rev(id) + 1);
  }

  /** Cached translation statistics for a project. */
  function stats(p) {
    const target = p || project();
    if (!target) return { total: 0, filled: {}, complete: 0 };
    const cached = statsCache.get(target.id);
    if (cached && cached.rev === rev(target.id) && cached.project === target) return cached.stats;
    const s = ops.computeStats(target);
    statsCache.set(target.id, { rev: rev(target.id), project: target, stats: s });
    return s;
  }

  const getValue = (key, lang, p) => ops.getValue(p || project(), key, lang);
  const hasKey = (key, p) => ops.hasKey(p || project(), key);

  /* ---- Persistence ------------------------------------------------------------- */

  const scheduleSave = util.debounce(() => {
    flush();
  }, 250);

  function setSaveStatus(status, error) {
    if (saveStatus === status && !error) return;
    saveStatus = status;
    emit("save", { status, error });
  }

  function hasPendingChanges() {
    return dirty.settings || dirty.ui || dirty.flags || dirty.projects.size > 0 || dirty.deleted.size > 0;
  }

  function touchProject(id) {
    dirty.projects.add(id);
    dirty.deleted.delete(id);
    scheduleSave();
  }
  function touchUI() {
    dirty.ui = true;
    scheduleSave();
  }
  function touchSettings() {
    dirty.settings = true;
    scheduleSave();
  }

  /** Write pending changes now. Safe to call often; concurrent calls are chained. */
  async function flush() {
    scheduleSave.cancel();
    if (saving) return;
    if (!hasPendingChanges()) return;
    saving = true;
    const patch = {
      settings: dirty.settings ? state.settings : undefined,
      ui: dirty.ui ? state.ui : undefined,
      flags: dirty.flags ? flags : undefined,
      projects: Array.from(dirty.projects)
        .map((id) => state.projects[id])
        .filter(Boolean),
      deleted: Array.from(dirty.deleted),
    };
    const snapshot = {
      settings: dirty.settings,
      ui: dirty.ui,
      flags: dirty.flags,
      projects: new Set(dirty.projects),
      deleted: new Set(dirty.deleted),
    };
    dirty.settings = dirty.ui = dirty.flags = false;
    dirty.projects.clear();
    dirty.deleted.clear();
    setSaveStatus("saving");
    try {
      await db.save(patch, Object.assign({}, state, { flags }));
      if (channel && (patch.projects.length || patch.deleted.length || patch.settings)) {
        channel.postMessage({
          type: "saved",
          tabId,
          projects: patch.projects.map((p) => p.id),
          deleted: patch.deleted,
          settings: !!patch.settings,
        });
      }
      saving = false;
      if (hasPendingChanges()) return flush();
      setSaveStatus("saved");
    } catch (e) {
      console.error("Saving failed:", e);
      // Put the flags back so a later attempt retries everything.
      dirty.settings = dirty.settings || snapshot.settings;
      dirty.ui = dirty.ui || snapshot.ui;
      dirty.flags = dirty.flags || snapshot.flags;
      snapshot.projects.forEach((id) => dirty.projects.add(id));
      snapshot.deleted.forEach((id) => dirty.deleted.add(id));
      saving = false;
      setSaveStatus("error", e);
    }
  }

  function mirrorTheme() {
    try {
      localStorage.setItem(THEME_MIRROR_KEY, state.settings.theme);
    } catch (e) {
      /* ignore */
    }
  }

  /* ---- Init --------------------------------------------------------------------- */

  /**
   * Load saved data (migrating from the original app when needed).
   * @returns {Promise<{mode: string, migrated: boolean, firstRun: boolean}>}
   */
  async function init() {
    const mode = await db.open();
    let migrated = false;
    let loaded = null;
    try {
      loaded = await db.loadAll();
    } catch (e) {
      console.error("Could not load saved data:", e);
    }

    if (loaded) {
      flags = loaded.flags && typeof loaded.flags === "object" ? loaded.flags : {};
      state = migrate.normalizeState(loaded);
    } else {
      const legacy = readLegacy();
      const converted = legacy ? migrate.fromV1(legacy) : null;
      if (converted) {
        state = converted;
        flags = { migratedFromV1: Date.now() };
        migrated = true;
        dirty.settings = dirty.ui = dirty.flags = true;
        Object.keys(state.projects).forEach((id) => dirty.projects.add(id));
        await flush();
      } else {
        state = migrate.emptyState();
        flags = {};
      }
    }
    mirrorTheme();

    if (typeof BroadcastChannel !== "undefined") {
      try {
        channel = new BroadcastChannel("language-surface");
        channel.onmessage = (ev) => onRemoteSave(ev.data);
      } catch (e) {
        channel = null;
      }
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flush();
      });
      window.addEventListener("pagehide", () => flush());
    }
    return { mode, migrated, firstRun: !loaded && !migrated };
  }

  function readLegacy() {
    try {
      const raw = localStorage.getItem(migrate.LEGACY_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  /** Another tab saved: pull its changes in so this tab never overwrites them with stale data. */
  async function onRemoteSave(msg) {
    if (!msg || msg.tabId === tabId) return;
    if (msg.type === "reset") return location.reload();
    if (msg.type !== "saved") return;
    try {
      const ids = (msg.projects || []).filter((id) => !dirty.projects.has(id));
      const res = await db.reload(ids, !!msg.settings && !dirty.settings);
      let listChanged = false;
      const current = state.ui.selectedProjectId;
      let currentChanged = false;
      for (const id of Object.keys(res.projects)) {
        if (!state.projects[id]) listChanged = true;
        state.projects[id] = ops.normalizeProject(res.projects[id]);
        histories.delete(id);
        bump(id);
        reconcileView(state.projects[id]);
        if (id === current) currentChanged = true;
      }
      for (const id of (msg.deleted || []).concat(res.missing)) {
        if (state.projects[id] && !dirty.projects.has(id)) {
          delete state.projects[id];
          delete state.ui.views[id];
          histories.delete(id);
          listChanged = true;
          if (id === current) {
            state.ui.selectedProjectId = Object.keys(state.projects)[0] || null;
            currentChanged = true;
          }
        }
      }
      if (res.settings) {
        state.settings = migrate.normalizeSettings(res.settings);
        mirrorTheme();
        emit("settings", { path: "*" });
      }
      if (listChanged || currentChanged) emit("projects", { reason: "sync" });
      if (currentChanged) {
        emit("project", { fields: ["*"] });
        emit("entries", { kind: "structure" });
        emit("history", {});
      }
    } catch (e) {
      console.warn("Could not sync changes from another tab:", e);
    }
  }

  /* ---- History ------------------------------------------------------------------ */

  function historyFor(id) {
    if (!histories.has(id)) histories.set(id, { undo: [], redo: [] });
    return histories.get(id);
  }

  /** Keep view state valid after languages change. */
  function reconcileView(p) {
    const v = state.ui.views[p.id] || (state.ui.views[p.id] = migrate.defaultView(p));
    const visible = p.languages.filter((l) => v.visibleLangs.includes(l));
    v.visibleLangs = visible.length ? visible : p.languages.slice(0, 1);
    if (v.sortBy !== "key" && !p.languages.includes(v.sortBy.replace(/^lang:/, ""))) {
      v.sortBy = "key";
      v.sortDir = "asc";
    }
    for (const l of Object.keys(v.colWidths)) if (!p.languages.includes(l)) delete v.colWidths[l];
  }

  /** Carry column visibility, widths and sorting across language renames and additions. */
  function syncViewForOps(p, opList) {
    const v = state.ui.views[p.id];
    if (!v) return;
    for (const op of opList) {
      if (op.t === "renLang") {
        v.visibleLangs = v.visibleLangs.map((l) => (l === op.from ? op.to : l));
        if (v.colWidths[op.from]) {
          v.colWidths[op.to] = v.colWidths[op.from];
          delete v.colWidths[op.from];
        }
        if (v.sortBy === "lang:" + op.from) v.sortBy = "lang:" + op.to;
      } else if (op.t === "addLang" && !v.visibleLangs.includes(op.lang)) {
        v.visibleLangs = v.visibleLangs.concat([op.lang]);
      }
    }
  }

  function announce(p, opList) {
    const d = ops.describeOps(opList);
    const isCurrent = p.id === state.ui.selectedProjectId;
    if (d.structural || d.meta) {
      syncViewForOps(p, opList);
      reconcileView(p);
      touchUI();
    }
    if (!isCurrent) {
      if (d.meta) emit("projects", { reason: "meta" });
      return;
    }
    if (d.meta || d.structural) {
      const fields = opList.filter((o) => o.t === "field").map((o) => o.field);
      emit("project", { fields: d.structural ? fields.concat(["structure"]) : fields });
      if (fields.includes("name")) emit("projects", { reason: "meta" });
    }
    if (d.structural) emit("entries", { kind: "structure" });
    else if (d.single) emit("entries", { kind: "cell", key: d.single.key, lang: d.single.lang });
    else if (d.cells) emit("entries", { kind: "bulk" });
    emit("history", {});
  }

  /**
   * Apply ops to a project as one undoable step.
   * @returns {boolean} whether anything changed
   */
  function commit(p, label, opList, opts) {
    const o = opts || {};
    const inverse = ops.applyOps(p, opList);
    if (!inverse.length) return false;
    p.meta.updatedAt = Date.now();
    bump(p.id);
    const h = historyFor(p.id);
    const last = h.undo[h.undo.length - 1];
    const now = Date.now();
    // `coalesce` merges quick successive edits of one field; `group` merges a whole batch
    // (e.g. an AI run that fills cells one by one) into a single undo step.
    const group = o.group || o.coalesce || null;
    const window = o.group ? Infinity : COALESCE_MS;
    if (group && last && last.group === group && now - last.at < window && !h.redo.length) {
      last.ops = inverse.concat(last.ops);
      last.at = now;
    } else {
      h.undo.push({ id: ++historySeq, label, ops: inverse, at: now, group });
      if (h.undo.length > HISTORY_LIMIT) h.undo.shift();
    }
    h.redo.length = 0;
    touchProject(p.id);
    announce(p, opList);
    return true;
  }

  function canUndo() {
    const p = project();
    return !!p && historyFor(p.id).undo.length > 0;
  }
  function canRedo() {
    const p = project();
    return !!p && historyFor(p.id).redo.length > 0;
  }

  function step(from, to) {
    const p = project();
    if (!p) return null;
    const h = historyFor(p.id);
    const entry = h[from].pop();
    if (!entry) return null;
    const back = ops.applyOps(p, entry.ops);
    h[to].push({ id: ++historySeq, label: entry.label, ops: back, at: Date.now(), group: null });
    p.meta.updatedAt = Date.now();
    bump(p.id);
    touchProject(p.id);
    syncViewForOps(p, entry.ops);
    reconcileView(p);
    touchUI();
    emit("project", { fields: ["*"] });
    emit("projects", { reason: "meta" });
    emit("entries", { kind: "structure" });
    emit("history", {});
    return entry.label;
  }

  /** Undo the last change in the current project. Returns its label, or null. */
  const undo = () => step("undo", "redo");
  const redo = () => step("redo", "undo");

  /** Identifies the most recent change, so an "Undo" button can target exactly that change. */
  function undoToken() {
    const p = project();
    if (!p) return null;
    const stack = historyFor(p.id).undo;
    const top = stack[stack.length - 1];
    return top ? { projectId: p.id, id: top.id } : null;
  }

  /** Undo only if `token` still names the latest change of the current project. */
  function undoIfLatest(token) {
    const p = project();
    if (!token || !p || p.id !== token.projectId) return null;
    const stack = historyFor(p.id).undo;
    const top = stack[stack.length - 1];
    if (!top || top.id !== token.id) return null;
    return undo();
  }

  /* ---- Settings & UI ------------------------------------------------------------- */

  function setSetting(path, value) {
    const parts = path.split(".");
    let node = state.settings;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node[parts[i]] || typeof node[parts[i]] !== "object") node[parts[i]] = {};
      node = node[parts[i]];
    }
    const leaf = parts[parts.length - 1];
    if (node[leaf] === value) return;
    node[leaf] = value;
    if (path === "theme") mirrorTheme();
    touchSettings();
    emit("settings", { path });
  }

  function setUI(patch) {
    const keys = [];
    for (const k of Object.keys(patch)) {
      if (state.ui[k] !== patch[k]) {
        state.ui[k] = patch[k];
        keys.push(k);
      }
    }
    if (!keys.length) return;
    touchUI();
    emit("ui", { keys });
  }

  function setView(patch) {
    const p = project();
    if (!p) return;
    const v = view();
    const keys = [];
    for (const k of Object.keys(patch)) {
      const same = Array.isArray(patch[k]) && Array.isArray(v[k]) ? patch[k].join("\u0000") === v[k].join("\u0000") : v[k] === patch[k];
      if (!same) {
        v[k] = patch[k];
        keys.push(k);
      }
    }
    if (!keys.length) return;
    touchUI();
    emit("view", { keys });
  }

  /** Update a column width without a full view refresh (used while dragging). */
  function setColumnWidth(col, width) {
    const v = view();
    if (col === "@key") v.keyWidth = width;
    else if (width == null) delete v.colWidths[col];
    else v.colWidths[col] = width;
    touchUI();
  }

  /* ---- Projects ------------------------------------------------------------------- */

  function addProject(p, select) {
    state.projects[p.id] = p;
    state.ui.views[p.id] = migrate.defaultView(p);
    bump(p.id);
    touchProject(p.id);
    if (select !== false) state.ui.selectedProjectId = p.id;
    touchUI();
    emit("projects", { reason: "added", id: p.id });
    if (select !== false) emitProjectSwitched();
    return p;
  }

  function emitProjectSwitched() {
    emit("project", { fields: ["*"] });
    emit("entries", { kind: "structure" });
    emit("history", {});
  }

  function uniqueProjectName(base) {
    const names = new Set(Object.values(state.projects).map((p) => p.name.toLowerCase()));
    if (!names.has(base.toLowerCase())) return base;
    let n = 2;
    while (names.has((base + " " + n).toLowerCase())) n++;
    return base + " " + n;
  }

  function createProject(init) {
    const o = init || {};
    const name = String(o.name || "").trim() || uniqueProjectName("Untitled project");
    return addProject(ops.createProject(Object.assign({}, o, { name })));
  }

  function createSampleProject() {
    const p = ops.sampleProject();
    p.name = uniqueProjectName(p.name);
    return addProject(p);
  }

  function duplicateProject(id) {
    const p = project(id);
    if (!p) return null;
    return addProject(ops.cloneProject(p, uniqueProjectName(p.name + " (copy)")));
  }

  function selectProject(id) {
    if (!state.projects[id] || state.ui.selectedProjectId === id) return;
    state.ui.selectedProjectId = id;
    touchUI();
    emit("projects", { reason: "selected", id });
    emitProjectSwitched();
  }

  /** Delete a project. Returns it so the caller can offer an undo via restoreProject(). */
  function deleteProject(id) {
    const p = project(id);
    if (!p) return null;
    const viewState = state.ui.views[p.id];
    delete state.projects[p.id];
    delete state.ui.views[p.id];
    dirty.projects.delete(p.id);
    dirty.deleted.add(p.id);
    const wasCurrent = state.ui.selectedProjectId === p.id;
    if (wasCurrent) {
      const next = projectList()[0];
      state.ui.selectedProjectId = next ? next.id : null;
    }
    touchUI();
    emit("projects", { reason: "deleted", id: p.id });
    if (wasCurrent) emitProjectSwitched();
    return { project: p, view: viewState };
  }

  function restoreProject(removed) {
    if (!removed || !removed.project) return;
    const p = removed.project;
    state.projects[p.id] = p;
    state.ui.views[p.id] = removed.view || migrate.defaultView(p);
    bump(p.id);
    touchProject(p.id);
    state.ui.selectedProjectId = p.id;
    touchUI();
    emit("projects", { reason: "added", id: p.id });
    emitProjectSwitched();
  }

  function renameProject(name, id) {
    const p = project(id);
    const next = String(name || "").trim();
    if (!p || !next || next === p.name) return false;
    return commit(p, "Rename project", [{ t: "field", field: "name", value: next }]);
  }

  /* ---- Keys & values ---------------------------------------------------------------- */

  /**
   * Set one cell.
   * opts.coalesce merges rapid consecutive edits of the same cell into one undo step;
   * opts.group (+ opts.label) merges every edit of a batch into one undo step.
   */
  function setValue(key, lang, value, opts) {
    const p = project();
    if (!p || !ops.hasKey(p, key)) return false;
    const o = opts || {};
    const text = String(value == null ? "" : value);
    const coalesce = o.coalesce ? key + "\u0000" + lang : null;
    return commit(p, o.label || "Edit " + key, [{ t: "set", key, lang, value: text }], { coalesce, group: o.group || null });
  }

  /** Set many cells in one undoable step. */
  function setValues(changes, label) {
    const p = project();
    if (!p || !changes.length) return false;
    const list = changes.filter((c) => ops.hasKey(p, c.key)).map((c) => ({ t: "set", key: c.key, lang: c.lang, value: String(c.value == null ? "" : c.value) }));
    return commit(p, label || "Edit " + util.plural(list.length, "translation"), list);
  }

  function validateNewKey(raw, p) {
    const key = LS.keys.normalizeKey(raw);
    if (!key) return { ok: false, error: "Enter a key." };
    if (key === "__proto__") return { ok: false, error: "That key name is reserved." };
    if (ops.hasKey(p, key)) return { ok: false, error: "This key already exists.", key, exists: true };
    return { ok: true, key };
  }

  /** Add a key. values: optional { lang: text }. Returns { ok, key?, error? }. */
  function addKey(rawKey, values) {
    const p = project();
    if (!p) return { ok: false, error: "No project." };
    const check = validateNewKey(rawKey, p);
    if (!check.ok) return check;
    const entry = ops.newEntry();
    for (const l of p.languages) entry[l] = values && typeof values[l] === "string" ? values[l] : "";
    commit(p, "Add " + check.key, [{ t: "addKeys", items: [{ key: check.key, entry }] }]);
    return { ok: true, key: check.key };
  }

  function deleteKeys(keys) {
    const p = project();
    if (!p) return 0;
    const doomed = keys.filter((k) => ops.hasKey(p, k));
    if (!doomed.length) return 0;
    const set = new Set(doomed);
    const list = [];
    if (p.pinned.some((k) => set.has(k))) list.push({ t: "field", field: "pinned", value: p.pinned.filter((k) => !set.has(k)) });
    list.push({ t: "delKeys", keys: doomed });
    commit(p, doomed.length === 1 ? "Delete " + doomed[0] : "Delete " + util.plural(doomed.length, "key"), list);
    return doomed.length;
  }

  function renameKey(from, rawTo) {
    const p = project();
    if (!p || !ops.hasKey(p, from)) return { ok: false, error: "Key not found." };
    const to = LS.keys.normalizeKey(rawTo);
    if (to === from) return { ok: true, key: from, unchanged: true };
    const check = validateNewKey(to, p);
    if (!check.ok) return check;
    commit(p, "Rename " + from, [{ t: "renKey", from, to }]);
    return { ok: true, key: to };
  }

  function duplicateKey(key) {
    const p = project();
    if (!p || !ops.hasKey(p, key)) return null;
    const copyKey = LS.keys.uniqueKey(key, (k) => ops.hasKey(p, k));
    const entry = ops.newEntry(p.entries[key]);
    const index = Object.keys(p.entries).indexOf(key) + 1;
    commit(p, "Duplicate " + key, [{ t: "addKeys", items: [{ key: copyKey, entry, index }] }]);
    return copyKey;
  }

  function setPinned(keys, pinned) {
    const p = project();
    if (!p) return false;
    const set = new Set(keys);
    let next;
    if (pinned) next = p.pinned.concat(keys.filter((k) => ops.hasKey(p, k) && !p.pinned.includes(k)));
    else next = p.pinned.filter((k) => !set.has(k));
    if (next.length === p.pinned.length && next.every((k, i) => k === p.pinned[i])) return false;
    return commit(p, pinned ? "Pin" : "Unpin", [{ t: "field", field: "pinned", value: next }]);
  }

  function isPinned(key) {
    const p = project();
    return !!p && p.pinned.includes(key);
  }

  /* ---- Languages ------------------------------------------------------------------- */

  function addLanguage(rawCode) {
    const p = project();
    const code = langs.normalize(rawCode);
    if (!p) return { ok: false, error: "No project." };
    if (!code) return { ok: false, error: "Enter a language code, e.g. en, ja or fr-ca." };
    if (p.languages.includes(code)) return { ok: false, error: langs.label(code) + " is already in this project.", exists: true };
    commit(p, "Add " + langs.label(code), [{ t: "addLang", lang: code }]);
    return { ok: true, code };
  }

  function removeLanguage(code) {
    const p = project();
    if (!p || !p.languages.includes(code)) return { ok: false, error: "Language not found." };
    if (p.languages.length <= 1) return { ok: false, error: "A project needs at least one language." };
    const list = [];
    if (p.sourceLang === code) list.push({ t: "field", field: "sourceLang", value: p.languages.find((l) => l !== code) });
    list.push({ t: "delLang", lang: code });
    commit(p, "Remove " + langs.label(code), list);
    return { ok: true };
  }

  function renameLanguage(from, rawTo) {
    const p = project();
    const to = langs.normalize(rawTo);
    if (!p || !p.languages.includes(from)) return { ok: false, error: "Language not found." };
    if (!to) return { ok: false, error: "Enter a new language code." };
    if (to === from) return { ok: true, code: from, unchanged: true };
    if (p.languages.includes(to)) return { ok: false, error: langs.label(to) + " already exists in this project." };
    const list = [];
    if (p.glossary.some((g) => g.sourceLang === from || g.targetLang === from)) {
      list.push({
        t: "field",
        field: "glossary",
        value: p.glossary.map((g) =>
          g.sourceLang === from || g.targetLang === from
            ? Object.assign({}, g, { sourceLang: g.sourceLang === from ? to : g.sourceLang, targetLang: g.targetLang === from ? to : g.targetLang })
            : g
        ),
      });
    }
    list.push({ t: "renLang", from, to });
    commit(p, "Rename " + langs.label(from) + " to " + langs.label(to), list);
    return { ok: true, code: to };
  }

  function moveLanguage(code, delta) {
    const p = project();
    if (!p) return false;
    const i = p.languages.indexOf(code);
    const j = i + delta;
    if (i === -1 || j < 0 || j >= p.languages.length) return false;
    const next = p.languages.slice();
    next.splice(i, 1);
    next.splice(j, 0, code);
    return commit(p, "Reorder languages", [{ t: "field", field: "languages", value: next }]);
  }

  function setSourceLang(code) {
    const p = project();
    if (!p || !p.languages.includes(code) || p.sourceLang === code) return false;
    return commit(p, "Set source language", [{ t: "field", field: "sourceLang", value: code }]);
  }

  /* ---- Glossary & context ------------------------------------------------------------ */

  function setContext(text) {
    const p = project();
    if (!p) return false;
    return commit(p, "Edit AI instructions", [{ t: "field", field: "context", value: String(text || "") }], { coalesce: "context" });
  }

  function validateRule(p, rule, ignoreId) {
    const from = String(rule.from || "").trim();
    const to = String(rule.to || "").trim();
    const sourceLang = String(rule.sourceLang || "all").toLowerCase();
    const targetLang = String(rule.targetLang || "all").toLowerCase();
    if (!from) return { ok: false, error: "Enter the source term." };
    if (!to) return { ok: false, error: "Enter the translation." };
    if (sourceLang === targetLang && sourceLang !== "all") return { ok: false, error: "Source and target languages must differ." };
    const dup = p.glossary.some((g) => g.id !== ignoreId && g.from === from && g.sourceLang === sourceLang && g.targetLang === targetLang);
    if (dup) return { ok: false, error: "This term already exists for that language pair." };
    return { ok: true, rule: { from, to, sourceLang, targetLang } };
  }

  function addRule(rule) {
    const p = project();
    if (!p) return { ok: false, error: "No project." };
    const check = validateRule(p, rule);
    if (!check.ok) return check;
    const next = p.glossary.concat([Object.assign({ id: util.uid("g") }, check.rule)]);
    commit(p, "Add glossary term", [{ t: "field", field: "glossary", value: next }]);
    return { ok: true };
  }

  function updateRule(id, patch) {
    const p = project();
    if (!p) return { ok: false, error: "No project." };
    const current = p.glossary.find((g) => g.id === id);
    if (!current) return { ok: false, error: "Term not found." };
    const check = validateRule(p, Object.assign({}, current, patch), id);
    if (!check.ok) return check;
    const next = p.glossary.map((g) => (g.id === id ? Object.assign({ id }, check.rule) : g));
    commit(p, "Edit glossary term", [{ t: "field", field: "glossary", value: next }]);
    return { ok: true };
  }

  function removeRule(id) {
    const p = project();
    if (!p) return false;
    const next = p.glossary.filter((g) => g.id !== id);
    if (next.length === p.glossary.length) return false;
    return commit(p, "Remove glossary term", [{ t: "field", field: "glossary", value: next }]);
  }

  /* ---- Import -------------------------------------------------------------------------- */

  /**
   * Merge an import plan into the current project as one undoable step.
   * @returns {{addedKeys: number, addedLangs: string[], changed: number}}
   */
  function applyImport(plan, mode) {
    const p = project();
    if (!p) return { addedKeys: 0, addedLangs: [], changed: 0 };
    const { addKeys, addLangs, changes } = LS.importer.planChanges(p, plan, mode);
    const list = [];
    for (const lang of addLangs) list.push({ t: "addLang", lang });
    if (addKeys.length) list.push({ t: "addKeys", items: addKeys.map((key) => ({ key, entry: ops.newEntry() })) });
    for (const c of changes) list.push({ t: "set", key: c.key, lang: c.lang, value: c.value });
    if (list.length) commit(p, "Import", list);
    return { addedKeys: addKeys.length, addedLangs: addLangs, changed: changes.length };
  }

  /* ---- Backup, restore, reset ----------------------------------------------------------- */

  /** Everything needed to restore the app elsewhere. API keys are left out unless asked for. */
  function exportBackup(opts) {
    const includeKeys = !!(opts && opts.includeKeys);
    const settings = util.deepClone(state.settings);
    if (!includeKeys) for (const id of Object.keys(settings.ai.providers)) settings.ai.providers[id].apiKey = "";
    return {
      app: "language-surface",
      version: migrate.VERSION,
      exportedAt: new Date().toISOString(),
      settings,
      projects: Object.values(state.projects).map((p) => JSON.parse(JSON.stringify(p))),
    };
  }

  /**
   * Restore projects from a backup file (or from data saved by the original app).
   * Existing projects are kept; restored ones are added next to them.
   * @returns {{ok: boolean, count?: number, error?: string}}
   */
  function importBackup(data) {
    let incoming = [];
    if (data && data.app === "language-surface" && Array.isArray(data.projects)) {
      incoming = data.projects;
    } else if (data && data.projects && typeof data.projects === "object" && !Array.isArray(data.projects)) {
      const converted = migrate.fromV1(Object.assign({ ui: { seenWelcome: true } }, data, { ui: Object.assign({}, data.ui, { seenWelcome: true }) }));
      incoming = converted ? Object.values(converted.projects) : [];
    } else {
      return { ok: false, error: "This file is not a Language Surface backup." };
    }
    if (!incoming.length) return { ok: false, error: "The backup contains no projects." };
    let last = null;
    for (const raw of incoming) {
      const p = ops.normalizeProject(raw);
      if (state.projects[p.id]) p.id = util.uid("p");
      p.name = uniqueProjectName(p.name);
      last = addProject(p, false);
    }
    if (last) selectProject(last.id);
    return { ok: true, count: incoming.length };
  }

  /** Erase everything this app stored in this browser. */
  async function resetAll() {
    scheduleSave.cancel();
    dirty.settings = dirty.ui = dirty.flags = false;
    dirty.projects.clear();
    dirty.deleted.clear();
    await db.clear();
    try {
      localStorage.removeItem(migrate.LEGACY_KEY);
      localStorage.removeItem(THEME_MIRROR_KEY);
    } catch (e) {
      /* ignore */
    }
    state = migrate.emptyState();
    flags = {};
    histories.clear();
    revs.clear();
    statsCache.clear();
    mirrorTheme();
    if (channel) channel.postMessage({ type: "reset", tabId });
    setSaveStatus("saved");
    emit("settings", { path: "*" });
    emit("ui", { keys: ["*"] });
    emit("projects", { reason: "reset" });
    emitProjectSwitched();
  }

  LS.store = {
    init,
    on,
    off,
    get state() {
      return state;
    },
    get saveStatus() {
      return saveStatus;
    },
    get flags() {
      return flags;
    },
    project,
    projectList,
    view,
    stats,
    rev,
    getValue,
    hasKey,
    flush,
    hasPendingChanges,
    // history
    undo,
    redo,
    canUndo,
    canRedo,
    undoToken,
    undoIfLatest,
    // settings / ui
    setSetting,
    setUI,
    setView,
    setColumnWidth,
    // projects
    createProject,
    createSampleProject,
    duplicateProject,
    selectProject,
    deleteProject,
    restoreProject,
    renameProject,
    // keys
    setValue,
    setValues,
    validateNewKey: (raw) => validateNewKey(raw, project()),
    addKey,
    deleteKeys,
    renameKey,
    duplicateKey,
    setPinned,
    isPinned,
    // languages
    addLanguage,
    removeLanguage,
    renameLanguage,
    moveLanguage,
    setSourceLang,
    // glossary
    setContext,
    addRule,
    updateRule,
    removeRule,
    // import / backup
    applyImport,
    exportBackup,
    importBackup,
    resetAll,
  };
})(globalThis.LS || (globalThis.LS = {}));
