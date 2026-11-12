const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// The store normally runs in a browser; in Node it falls back to memory-only persistence.
globalThis.BroadcastChannel = undefined;
const LS = require("./_load.js");
require(path.join(__dirname, "..", "js", "store", "db.js"));
require(path.join(__dirname, "..", "js", "store", "store.js"));

const { store } = LS;
const plain = (v) => JSON.parse(JSON.stringify(v));

function record() {
  const events = [];
  const off = store.on("*", (data, type) => events.push(type + (data.kind ? ":" + data.kind : "")));
  return { events, off };
}

test("store boots empty in memory mode", async () => {
  const res = await store.init();
  assert.equal(res.mode, "memory");
  assert.equal(res.firstRun, true);
  assert.equal(store.project(), null);
  assert.deepEqual(store.projectList(), []);
});

test("projects: create, select, rename, duplicate, delete and restore", () => {
  const a = store.createProject({ name: "Alpha", languages: ["en", "ja"] });
  assert.equal(store.project().id, a.id);
  const b = store.createProject({ name: "" });
  assert.equal(b.name, "Untitled project");
  assert.equal(store.createProject({}).name, "Untitled project 2");
  store.selectProject(a.id);
  assert.equal(store.project().name, "Alpha");
  assert.ok(store.renameProject("  Alpha One "));
  assert.equal(store.project().name, "Alpha One");
  assert.equal(store.renameProject(""), false);

  const copy = store.duplicateProject(a.id);
  assert.equal(copy.name, "Alpha One (copy)");
  assert.equal(store.project().id, copy.id);

  const removed = store.deleteProject(copy.id);
  assert.ok(!store.state.projects[copy.id]);
  assert.ok(store.project(), "another project becomes current");
  store.restoreProject(removed);
  assert.equal(store.project().id, copy.id);
  store.deleteProject(copy.id);
  store.selectProject(a.id);
});

test("keys: add, validate, edit, rename, duplicate, delete with undo/redo", () => {
  const p = store.project();
  assert.deepEqual(store.addKey("  lp.hello "), { ok: true, key: "lp.hello" });
  assert.equal(store.addKey("lp.hello").exists, true);
  assert.equal(store.addKey("   ").ok, false);
  assert.equal(store.addKey("__proto__").ok, false);
  assert.deepEqual(plain(p.entries["lp.hello"]), { en: "", ja: "" });
  store.addKey("lp.bye", { en: "Good Bye" });
  assert.equal(store.getValue("lp.bye", "en"), "Good Bye");

  assert.ok(store.setValue("lp.hello", "en", "Hello"));
  assert.equal(store.setValue("lp.hello", "en", "Hello"), false, "no-op edits are not recorded");
  assert.equal(store.setValue("missing", "en", "x"), false);

  assert.equal(store.undo(), "Edit lp.hello");
  assert.equal(store.getValue("lp.hello", "en"), "");
  assert.equal(store.redo(), "Edit lp.hello");
  assert.equal(store.getValue("lp.hello", "en"), "Hello");

  assert.deepEqual(store.renameKey("lp.hello", "lp.hi"), { ok: true, key: "lp.hi" });
  assert.equal(store.renameKey("lp.hi", "lp.bye").ok, false);
  assert.deepEqual(Object.keys(p.entries), ["lp.hi", "lp.bye"]);

  const copyKey = store.duplicateKey("lp.hi");
  assert.equal(copyKey, "lp.hi_copy");
  assert.deepEqual(Object.keys(p.entries), ["lp.hi", "lp.hi_copy", "lp.bye"]);
  assert.equal(store.getValue(copyKey, "en"), "Hello");

  store.setPinned(["lp.bye", "lp.hi"], true);
  assert.deepEqual(p.pinned, ["lp.bye", "lp.hi"]);
  assert.equal(store.deleteKeys(["lp.bye", "ghost"]), 1);
  assert.deepEqual(p.pinned, ["lp.hi"]);
  store.undo();
  assert.deepEqual(Object.keys(p.entries), ["lp.hi", "lp.hi_copy", "lp.bye"]);
  assert.deepEqual(p.pinned, ["lp.bye", "lp.hi"], "undo restores the key, its position and its pin");
  store.setPinned(["lp.bye", "lp.hi"], false);
});

test("rapid edits of one cell collapse into a single undo step", () => {
  store.setValue("lp.bye", "ja", "さ", { coalesce: true });
  store.setValue("lp.bye", "ja", "さよ", { coalesce: true });
  store.setValue("lp.bye", "ja", "さようなら", { coalesce: true });
  store.undo();
  assert.equal(store.getValue("lp.bye", "ja"), "");
  store.redo();
  assert.equal(store.getValue("lp.bye", "ja"), "さようなら");
});

test("bulk edits are one undo step and announce a bulk change", () => {
  const { events, off } = record();
  store.setValues(
    [
      { key: "lp.hi", lang: "ja", value: "やあ" },
      { key: "lp.hi_copy", lang: "ja", value: "やあ" },
      { key: "ghost", lang: "ja", value: "x" },
    ],
    "Translate"
  );
  off();
  assert.ok(events.includes("entries:bulk"));
  assert.equal(store.undo(), "Translate");
  assert.equal(store.getValue("lp.hi", "ja"), "");
  store.redo();
});

test("languages: add, rename, reorder, source, remove — and the view follows", () => {
  const p = store.project();
  assert.equal(store.addLanguage("FR_ca").code, "fr-ca");
  assert.equal(store.addLanguage("fr-ca").exists, true);
  assert.equal(store.addLanguage("").ok, false);
  assert.deepEqual(store.view().visibleLangs, ["en", "ja", "fr-ca"]);

  store.setView({ sortBy: "lang:fr-ca", sortDir: "desc" });
  store.setColumnWidth("fr-ca", 333);
  store.setValue("lp.hi", "fr-ca", "Salut");
  assert.deepEqual(store.renameLanguage("fr-ca", "fr"), { ok: true, code: "fr" });
  assert.deepEqual(p.languages, ["en", "ja", "fr"]);
  assert.equal(store.getValue("lp.hi", "fr"), "Salut");
  assert.deepEqual(store.view().visibleLangs, ["en", "ja", "fr"]);
  assert.equal(store.view().sortBy, "lang:fr");
  assert.equal(store.view().colWidths.fr, 333);
  store.undo();
  assert.deepEqual(store.view().visibleLangs, ["en", "ja", "fr-ca"], "undoing a rename keeps the column visible");
  store.redo();
  assert.equal(store.renameLanguage("fr", "ja").ok, false);

  assert.ok(store.moveLanguage("fr", -2));
  assert.deepEqual(p.languages, ["fr", "en", "ja"]);
  assert.deepEqual(store.view().visibleLangs, ["fr", "en", "ja"]);
  assert.equal(store.moveLanguage("fr", -1), false);

  assert.ok(store.setSourceLang("ja"));
  assert.equal(store.removeLanguage("ja").ok, true);
  assert.equal(p.sourceLang, "fr", "removing the source language picks another one");
  assert.equal(store.view().sortBy, "lang:fr");
  store.undo();
  assert.deepEqual(p.languages, ["fr", "en", "ja"]);
  assert.equal(p.sourceLang, "ja");
  assert.equal(store.getValue("lp.bye", "ja"), "さようなら");
  assert.ok(store.view().visibleLangs.includes("ja"), "a restored language is visible again");

  store.removeLanguage("fr");
  store.removeLanguage("en");
  assert.equal(store.removeLanguage("ja").ok, false, "the last language cannot be removed");
  store.undo();
  store.undo();
});

test("glossary rules: validation, edit, rename follows languages", () => {
  const p = store.project();
  assert.equal(store.addRule({ from: "", to: "x" }).ok, false);
  assert.equal(store.addRule({ sourceLang: "en", targetLang: "en", from: "a", to: "b" }).ok, false);
  assert.ok(store.addRule({ sourceLang: "en", targetLang: "ja", from: " sword ", to: "剣" }).ok);
  assert.equal(store.addRule({ sourceLang: "en", targetLang: "ja", from: "sword", to: "刀" }).ok, false, "duplicate term");
  assert.ok(store.addRule({ from: "Lv.*", to: "Lv.*" }).ok);
  assert.equal(p.glossary.length, 2);
  const id = p.glossary[0].id;
  assert.ok(store.updateRule(id, { to: "刀" }).ok);
  assert.equal(p.glossary[0].to, "刀");

  store.renameLanguage("ja", "ja-jp");
  assert.equal(p.glossary[0].targetLang, "ja-jp");
  store.undo();
  assert.equal(p.glossary[0].targetLang, "ja");

  assert.ok(store.removeRule(id));
  assert.equal(p.glossary.length, 1);
  store.setContext("Fantasy RPG");
  assert.equal(p.context, "Fantasy RPG");
});

test("applyImport merges a plan as one undoable step", () => {
  const p = store.project();
  const before = plain(p);
  const src = LS.importer.analyzeFile({ name: "in.csv", text: "key,en,de\nlp.hi,Hello there,Hallo\nnew.key,New,Neu\n" });
  const plan = LS.importer.buildPlan([src]);
  const res = store.applyImport(plan, "overwrite");
  assert.deepEqual(res, { addedKeys: 1, addedLangs: ["de"], changed: 4 });
  assert.equal(store.getValue("lp.hi", "en"), "Hello there");
  assert.equal(store.getValue("new.key", "de"), "Neu");
  assert.ok(store.view().visibleLangs.includes("de"));
  assert.equal(store.undo(), "Import");
  assert.deepEqual(plain(p).entries, before.entries);
  assert.deepEqual(p.languages, before.languages);
});

test("stats are cached per revision", () => {
  const a = store.stats();
  assert.equal(store.stats(), a);
  store.setValue("lp.hi", "en", "Changed");
  const b = store.stats();
  assert.notEqual(b, a);
  assert.equal(b.total, Object.keys(store.project().entries).length);
});

test("settings and view updates emit events only when something changes", () => {
  const { events, off } = record();
  store.setSetting("theme", "dark");
  store.setSetting("theme", "dark");
  store.setSetting("ai.providers.openai.apiKey", "sk-123");
  store.setView({ status: "missing" });
  store.setView({ status: "missing" });
  store.setUI({ sidebarCollapsed: true });
  off();
  assert.deepEqual(events.filter((e) => e !== "save"), ["settings", "settings", "view", "ui"]);
  assert.equal(store.state.settings.ai.providers.openai.apiKey, "sk-123");
});

test("backup excludes API keys by default and can be restored", () => {
  const backup = store.exportBackup();
  assert.equal(backup.app, "language-surface");
  assert.equal(backup.settings.ai.providers.openai.apiKey, "");
  assert.equal(store.exportBackup({ includeKeys: true }).settings.ai.providers.openai.apiKey, "sk-123");
  const count = Object.keys(store.state.projects).length;
  const res = store.importBackup(JSON.parse(JSON.stringify(backup)));
  assert.equal(res.ok, true);
  assert.equal(Object.keys(store.state.projects).length, count * 2, "restored projects are added, not merged over existing ones");
  assert.equal(store.importBackup({ hello: "world" }).ok, false);

  const legacy = { settings: {}, ui: {}, projects: { p1: { id: "p1", name: "Old", languages: ["en"], entries: { a: { en: "A" } } } } };
  assert.equal(store.importBackup(legacy).ok, true);
  assert.equal(store.project().name, "Old");
});

test("resetAll clears everything", async () => {
  await store.resetAll();
  assert.equal(store.project(), null);
  assert.equal(store.state.settings.theme, "system");
  assert.equal(store.canUndo(), false);
});

test("grouped edits (an AI run) undo as one step even when spread over time", async () => {
  await store.init();
  store.createProject({ name: "Grouped", languages: ["en", "ja", "fr"] });
  store.addKey("a", { en: "A" });
  store.addKey("b", { en: "B" });
  store.setValue("a", "ja", "あ", { group: "run-1", label: "AI translate" });
  store.setValue("b", "ja", "び", { group: "run-1", label: "AI translate" });
  store.setValue("a", "fr", "Ah", { group: "run-1", label: "AI translate" });
  assert.equal(store.undo(), "AI translate");
  assert.equal(store.getValue("a", "ja"), "");
  assert.equal(store.getValue("b", "ja"), "");
  assert.equal(store.getValue("a", "fr"), "");
  assert.equal(store.redo(), "AI translate");
  assert.equal(store.getValue("b", "ja"), "び");
  assert.equal(store.getValue("a", "fr"), "Ah");
  // A manual edit in between starts a new step.
  store.setValue("a", "ja", "ア");
  store.setValue("b", "fr", "Bé", { group: "run-1", label: "AI translate" });
  store.undo();
  assert.equal(store.getValue("b", "fr"), "");
  assert.equal(store.getValue("a", "ja"), "ア");
});

test("an undo token only undoes the change it was issued for", async () => {
  await store.init();
  const a = store.createProject({ name: "Tok A", languages: ["en"] });
  store.addKey("k", { en: "one" });
  store.setValue("k", "en", "two");
  const token = store.undoToken();
  assert.equal(store.undoIfLatest(token), "Edit k");
  assert.equal(store.getValue("k", "en"), "one");

  store.setValue("k", "en", "three");
  const stale = store.undoToken();
  store.setValue("k", "en", "four");
  assert.equal(store.undoIfLatest(stale), null, "a later change makes the token stale");
  assert.equal(store.getValue("k", "en"), "four");

  const fresh = store.undoToken();
  store.createProject({ name: "Tok B", languages: ["en"] });
  assert.equal(store.undoIfLatest(fresh), null, "tokens never apply to another project");
  store.selectProject(a.id);
  assert.equal(store.undoIfLatest(fresh), "Edit k");
  assert.equal(store.getValue("k", "en"), "three");
  assert.equal(store.undoIfLatest(null), null);
});
