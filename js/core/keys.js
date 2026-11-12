/* Language Surface — translation-key helpers: normalization, dotted paths, nesting and namespaces. */
(function (LS) {
  "use strict";

  const natCompare = LS.util.natCompare;

  /** Trim and collapse whitespace. Keys are otherwise free-form. */
  function normalizeKey(s) {
    return String(s == null ? "" : s)
      .trim()
      .replace(/\s+/g, " ");
  }

  /** "auth.errors.invalid" -> { ns: "auth.errors.", leaf: "invalid" } */
  function splitKey(key) {
    const k = String(key);
    const i = k.lastIndexOf(".");
    if (i <= 0 || i === k.length - 1) return { ns: "", leaf: k };
    return { ns: k.slice(0, i + 1), leaf: k.slice(i + 1) };
  }

  /** Namespace prefix of a key without the trailing dot ("auth.errors"), or "" for root keys. */
  function namespaceOf(key) {
    const ns = splitKey(key).ns;
    return ns ? ns.slice(0, -1) : "";
  }

  /**
   * Parse a dotted key into path segments. Bracket indexes become numbers:
   * "items[0].name" -> ["items", 0, "name"]. Empty segments are dropped.
   */
  function parsePath(key) {
    const out = [];
    for (const part of String(key).split(".")) {
      if (!part) continue;
      const m = part.match(/^([^[\]]*)((?:\[\d+\])+)$/);
      if (!m) {
        out.push(part);
        continue;
      }
      if (m[1]) out.push(m[1]);
      const re = /\[(\d+)\]/g;
      let im;
      while ((im = re.exec(m[2]))) out.push(Number(im[1]));
    }
    return out;
  }

  /**
   * Build a nested object from a flat { "a.b.c": value } map.
   * Bracket indexes rebuild arrays. A key is reported in `conflicts` (and skipped) when it is
   * both a value and a namespace, e.g. "menu" and "menu.title".
   * @param {Object} flat
   * @param {{hole?: any}} [opts] value used for missing array positions
   * @returns {{tree: Object, conflicts: string[]}}
   */
  function nest(flat, opts) {
    const hole = opts && "hole" in opts ? opts.hole : "";
    // Null-prototype containers: segments such as "__proto__" or "constructor" are plain data.
    const root = Object.create(null);
    const containers = new WeakSet([root]);
    const numeric = new WeakMap(); // container -> true while every child segment is an array index
    const conflicts = [];

    const child = (parent, seg) => {
      if (typeof seg === "number") {
        if (!numeric.has(parent)) numeric.set(parent, true);
      } else {
        numeric.set(parent, false);
      }
      return Object.prototype.hasOwnProperty.call(parent, seg) ? parent[seg] : undefined;
    };

    for (const key of Object.keys(flat)) {
      const path = parsePath(key);
      if (!path.length) continue;
      let cur = root;
      let blocked = false;
      for (let i = 0; i < path.length - 1; i++) {
        const seg = path[i];
        const next = child(cur, seg);
        if (next === undefined) {
          const made = Object.create(null);
          containers.add(made);
          cur[seg] = made;
          cur = made;
        } else if (containers.has(next)) {
          cur = next;
        } else {
          blocked = true;
          break;
        }
      }
      if (blocked) {
        conflicts.push(key);
        continue;
      }
      const last = path[path.length - 1];
      const existing = child(cur, last);
      if (existing !== undefined) {
        conflicts.push(key);
        continue;
      }
      cur[last] = flat[key];
    }

    const finalize = (node) => {
      if (!containers.has(node)) return node;
      const keys = Object.keys(node);
      for (const k of keys) node[k] = finalize(node[k]);
      if (numeric.get(node) === true && keys.length) {
        const max = Math.max.apply(null, keys.map(Number));
        // Only rebuild reasonably dense arrays; otherwise keep an object keyed by index.
        if (max < keys.length * 4 + 8) {
          const arr = [];
          for (let i = 0; i <= max; i++) arr.push(Object.prototype.hasOwnProperty.call(node, i) ? node[i] : hole);
          return arr;
        }
      }
      return node;
    };

    return { tree: finalize(root), conflicts };
  }

  /** Keys that cannot be represented in a nested structure (value/namespace collisions). */
  function nestingConflicts(keys) {
    const flat = Object.create(null);
    for (const k of keys) flat[k] = 1;
    return nest(flat).conflicts;
  }

  /**
   * Namespace tree for navigation. Only namespaces (prefixes) become nodes, never leaf keys.
   * @returns {{name: string, path: string, count: number, children: Array}} root node (path "")
   */
  function namespaceTree(keys) {
    const root = { name: "", path: "", count: 0, children: [], map: new Map() };
    for (const key of keys) {
      root.count++;
      const parts = String(key).split(".");
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!part) break;
        let next = node.map.get(part);
        if (!next) {
          next = { name: part, path: node.path ? node.path + "." + part : part, count: 0, children: [], map: new Map() };
          node.map.set(part, next);
          node.children.push(next);
        }
        next.count++;
        node = next;
      }
    }
    const sortRec = (node) => {
      node.children.sort((a, b) => natCompare(a.name, b.name));
      node.children.forEach(sortRec);
      delete node.map;
    };
    sortRec(root);
    return root;
  }

  /** Is `key` inside namespace `ns` ("auth" matches "auth.login" but not "authz.x")? */
  function inNamespace(key, ns) {
    if (!ns) return true;
    return key.length > ns.length && key.startsWith(ns) && key.charCodeAt(ns.length) === 46;
  }

  /** Suggest a free key name for duplicates: "a.b" -> "a.b_copy", "a.b_copy2", … */
  function uniqueKey(base, exists) {
    let candidate = base + "_copy";
    let n = 2;
    while (exists(candidate)) candidate = base + "_copy" + n++;
    return candidate;
  }

  LS.keys = { normalizeKey, splitKey, namespaceOf, parsePath, nest, nestingConflicts, namespaceTree, inNamespace, uniqueKey };
})(globalThis.LS || (globalThis.LS = {}));
