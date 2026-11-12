/* Language Surface — export a project as CSV, a single JSON map, or one JSON file per language. */
(function (LS) {
  "use strict";

  const { natCompare, safeFileName } = LS.util;
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  const DEFAULTS = {
    format: "json-per-lang", // "csv" | "json" | "json-per-lang"
    langs: null, // null = every project language
    keys: null, // null = every key
    sort: false,
    nested: true,
    codeStyle: "lower", // "lower" | "bcp47" | "underscore"
    naming: "lang", // "lang" -> en.json, "project" -> project_en.json
    delimiter: ",",
    bom: false,
  };

  function valueOf(project, key, lang) {
    const entry = hasOwn(project.entries, key) ? project.entries[key] : null;
    const v = entry ? entry[lang] : "";
    return typeof v === "string" ? v : "";
  }

  function resolve(project, options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    const langs = (o.langs && o.langs.length ? o.langs : project.languages).filter((l) => project.languages.includes(l));
    let keys;
    if (o.keys) {
      const wanted = new Set(o.keys);
      keys = Object.keys(project.entries).filter((k) => wanted.has(k));
    } else {
      keys = Object.keys(project.entries);
    }
    if (o.sort) keys.sort(natCompare);
    return { o, langs, keys };
  }

  function toJSONText(value) {
    return JSON.stringify(value, null, 2) + "\n";
  }

  /** Nest a flat map; keys that collide with a namespace are kept at the root under their flat name. */
  function structure(flat, nested, hole) {
    if (!nested) return { tree: flat, conflicts: [] };
    const { tree, conflicts } = LS.keys.nest(flat, { hole });
    for (const key of conflicts) tree[key] = flat[key];
    return { tree, conflicts };
  }

  function toCSV(project, options) {
    const { o, langs, keys } = resolve(project, options);
    const rows = [["key"].concat(langs.map((l) => LS.langs.formatCode(l, o.codeStyle)))];
    for (const key of keys) rows.push([key].concat(langs.map((l) => valueOf(project, key, l))));
    return LS.csv.stringify(rows, { delimiter: o.delimiter, bom: o.bom });
  }

  function toJSONMap(project, options) {
    const { o, langs, keys } = resolve(project, options);
    const flat = Object.create(null);
    for (const key of keys) {
      const map = {};
      for (const l of langs) map[LS.langs.formatCode(l, o.codeStyle)] = valueOf(project, key, l);
      flat[key] = map;
    }
    const { tree, conflicts } = structure(flat, o.nested, {});
    return { content: toJSONText(tree), conflicts };
  }

  function toJSONPerLang(project, options) {
    const { o, langs, keys } = resolve(project, options);
    const base = safeFileName(project.name);
    const files = [];
    let conflicts = [];
    for (const lang of langs) {
      const flat = Object.create(null);
      for (const key of keys) flat[key] = valueOf(project, key, lang);
      const res = structure(flat, o.nested, "");
      conflicts = res.conflicts;
      const code = LS.langs.formatCode(lang, o.codeStyle);
      files.push({
        lang,
        name: (o.naming === "project" ? base + "_" + code : code) + ".json",
        content: toJSONText(res.tree),
        mime: "application/json;charset=utf-8",
      });
    }
    return { files, conflicts };
  }

  /**
   * Build export output.
   * @returns {{files: {name, content, mime}[], archiveName: string, conflicts: string[], keyCount: number, langs: string[]}}
   */
  function build(project, options) {
    const { o, langs, keys } = resolve(project, options);
    const base = safeFileName(project.name);
    let files = [];
    let conflicts = [];
    if (o.format === "csv") {
      files = [{ name: base + ".csv", content: toCSV(project, o), mime: "text/csv;charset=utf-8" }];
    } else if (o.format === "json") {
      const res = toJSONMap(project, o);
      conflicts = res.conflicts;
      files = [{ name: base + ".json", content: res.content, mime: "application/json;charset=utf-8" }];
    } else {
      const res = toJSONPerLang(project, o);
      conflicts = res.conflicts;
      files = res.files;
    }
    return { files, archiveName: base + ".zip", conflicts, keyCount: keys.length, langs };
  }

  LS.exporter = { DEFAULTS, build, toCSV, toJSONMap, toJSONPerLang };
})(globalThis.LS || (globalThis.LS = {}));
