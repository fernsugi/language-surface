/* Language Surface — persistence.
 *
 * Primary store: IndexedDB (one record per project, so saving an edit never rewrites everything
 * and large projects are not limited by localStorage's ~5 MB quota).
 * Fallbacks: a single localStorage document, then memory only (private modes that block storage).
 * Nothing here ever talks to a server.
 */
(function (LS) {
  "use strict";

  const DB_NAME = "language-surface";
  const DB_VERSION = 1;
  const FALLBACK_KEY = "language_surface_v2";
  const META_KEYS = ["settings", "ui", "flags"];

  let mode = "memory"; // "idb" | "local" | "memory"
  let db = null;

  function promisify(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
    });
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
      tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
    });
  }

  function openIDB() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };
      // Some browsers never answer when storage is blocked; do not hang the app on that.
      const timer = setTimeout(() => finish(reject, new Error("IndexedDB did not respond")), 4000);
      let request;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        return finish(reject, e);
      }
      request.onupgradeneeded = () => {
        const d = request.result;
        if (!d.objectStoreNames.contains("projects")) d.createObjectStore("projects", { keyPath: "id" });
        if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv");
      };
      request.onsuccess = () => {
        const d = request.result;
        d.onversionchange = () => d.close();
        finish(resolve, d);
      };
      request.onerror = () => finish(reject, request.error || new Error("IndexedDB unavailable"));
      request.onblocked = () => finish(reject, new Error("IndexedDB blocked"));
    });
  }

  function localAvailable() {
    try {
      const k = "__ls_probe__";
      localStorage.setItem(k, "1");
      localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Open storage. Resolves with the mode in use: "idb" | "local" | "memory". */
  async function open() {
    if (typeof indexedDB !== "undefined") {
      try {
        db = await openIDB();
        mode = "idb";
        return mode;
      } catch (e) {
        console.warn("IndexedDB unavailable, falling back to localStorage:", e);
      }
    }
    mode = localAvailable() ? "local" : "memory";
    return mode;
  }

  /**
   * Load everything.
   * @returns {Promise<{settings, ui, flags, projects: Object}|null>} null when nothing was ever saved
   */
  async function loadAll() {
    if (mode === "idb") {
      const tx = db.transaction(["projects", "kv"], "readonly");
      const projectsReq = promisify(tx.objectStore("projects").getAll());
      const kv = tx.objectStore("kv");
      const metaReqs = META_KEYS.map((k) => promisify(kv.get(k)));
      const [list, settings, ui, flags] = await Promise.all([projectsReq].concat(metaReqs));
      if (settings === undefined && ui === undefined && !list.length) return null;
      const projects = {};
      for (const p of list) if (p && p.id) projects[p.id] = p;
      return { settings, ui, flags: flags || {}, projects };
    }
    if (mode === "local") {
      try {
        const raw = localStorage.getItem(FALLBACK_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        return data && typeof data === "object" ? data : null;
      } catch (e) {
        console.warn("Could not read saved data:", e);
        return null;
      }
    }
    return null;
  }

  /**
   * Persist changes.
   * @param {{settings?, ui?, flags?, projects?: Object[], deleted?: string[]}} patch only what changed
   * @param {Object} fullState the complete state (used by the single-document fallback)
   */
  async function save(patch, fullState) {
    if (mode === "idb") {
      const tx = db.transaction(["projects", "kv"], "readwrite");
      const done = txDone(tx);
      const kv = tx.objectStore("kv");
      const store = tx.objectStore("projects");
      for (const k of META_KEYS) if (patch[k] !== undefined) kv.put(patch[k], k);
      for (const p of patch.projects || []) store.put(p);
      for (const id of patch.deleted || []) store.delete(id);
      await done;
      return;
    }
    if (mode === "local") {
      localStorage.setItem(
        FALLBACK_KEY,
        JSON.stringify({ settings: fullState.settings, ui: fullState.ui, flags: fullState.flags || {}, projects: fullState.projects })
      );
    }
  }

  /** Read specific records again (used to pick up changes made in another tab). */
  async function reload(projectIds, wantSettings) {
    const out = { projects: {}, missing: [], settings: undefined };
    if (mode === "idb") {
      const tx = db.transaction(["projects", "kv"], "readonly");
      const store = tx.objectStore("projects");
      const reqs = projectIds.map((id) => promisify(store.get(id)));
      const settingsReq = wantSettings ? promisify(tx.objectStore("kv").get("settings")) : Promise.resolve(undefined);
      const results = await Promise.all(reqs.concat([settingsReq]));
      projectIds.forEach((id, i) => {
        if (results[i]) out.projects[id] = results[i];
        else out.missing.push(id);
      });
      out.settings = results[results.length - 1];
    } else if (mode === "local") {
      const all = (await loadAll()) || { projects: {} };
      for (const id of projectIds) {
        if (all.projects && all.projects[id]) out.projects[id] = all.projects[id];
        else out.missing.push(id);
      }
      if (wantSettings) out.settings = all.settings;
    }
    return out;
  }

  /** Remove everything this app stored. */
  async function clear() {
    if (mode === "idb") {
      const tx = db.transaction(["projects", "kv"], "readwrite");
      const done = txDone(tx);
      tx.objectStore("projects").clear();
      tx.objectStore("kv").clear();
      await done;
    }
    try {
      localStorage.removeItem(FALLBACK_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  /** Storage usage for this origin, when the browser exposes it. */
  async function estimate() {
    const out = { usage: null, quota: null, persisted: null };
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const e = await navigator.storage.estimate();
        out.usage = e.usage == null ? null : e.usage;
        out.quota = e.quota == null ? null : e.quota;
      }
      if (navigator.storage && navigator.storage.persisted) out.persisted = await navigator.storage.persisted();
    } catch (e) {
      /* ignore */
    }
    return out;
  }

  /** Ask the browser not to evict this origin's data under storage pressure. */
  async function requestPersistence() {
    try {
      if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
    } catch (e) {
      /* ignore */
    }
    return false;
  }

  LS.db = {
    open,
    loadAll,
    save,
    reload,
    clear,
    estimate,
    requestPersistence,
    get mode() {
      return mode;
    },
  };
})(globalThis.LS || (globalThis.LS = {}));
