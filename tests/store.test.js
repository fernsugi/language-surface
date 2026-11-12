const test = require("node:test");
const assert = require("node:assert/strict");
const LS = require("./_load.js");

const { ops, migrate } = LS;
const plain = (v) => JSON.parse(JSON.stringify(v));

function demo() {
  return ops.createProject({
    name: "Demo",
    languages: ["en", "ja", "fr"],
    entries: {
      "a.one": { en: "One", ja: "いち", fr: "Un" },
      "a.two": { en: "Two", ja: "に" },
      "b.three": { en: "Three" },
      "b.four": {},
    },
    glossary: [{ sourceLang: "en", targetLang: "ja", from: "One", to: "いち" }],
    pinned: ["a.two"],
  });
}

/** Apply ops, check the inverse restores the exact previous state, then re-apply. */
function roundTrip(project, list) {
  const before = plain(project);
  const inverse = ops.applyOps(project, list);
  const after = plain(project);
  const redo = ops.applyOps(project, inverse);
  assert.deepEqual(plain(project), before, "undo restores the previous state");
  assert.deepEqual(Object.keys(project.entries), Object.keys(before.entries), "undo restores key order");
  ops.applyOps(project, redo);
  assert.deepEqual(plain(project), after, "redo re-applies the change");
  return after;
}

test("createProject normalizes input", () => {
  const p = ops.createProject({ name: "X", languages: ["EN", "pt_BR", "en"], sourceLang: "pt-br", entries: { k: { EN: 1, en: "Hello", "pt-br": null } }, pinned: ["k", "ghost"] });
  assert.deepEqual(p.languages, ["en", "pt-br"]);
  assert.equal(p.sourceLang, "pt-br");
  assert.deepEqual(p.pinned, ["k"]);
  assert.equal(ops.getValue(p, "k", "en"), "Hello");
  assert.equal(ops.getValue(p, "k", "pt-br"), "");
  assert.equal(ops.getValue(p, "missing", "en"), "");
  assert.equal(Object.getPrototypeOf(p.entries), null);
});

test("entries behave as plain data for awkward keys", () => {
  const p = ops.createProject({ languages: ["en"], entries: {} });
  assert.equal(ops.hasKey(p, "constructor"), false);
  assert.equal(ops.hasKey(p, "toString"), false);
  ops.applyOps(p, [{ t: "addKeys", items: [{ key: "constructor", entry: ops.newEntry({ en: "c" }) }, { key: "__proto__", entry: ops.newEntry({ en: "p" }) }] }]);
  assert.deepEqual(Object.keys(p.entries), ["constructor", "__proto__"]);
  assert.equal(ops.getValue(p, "__proto__", "en"), "p");
  assert.equal(ops.getValue(p, "constructor", "constructor"), "");
});

test("set: value changes are invertible, no-ops return nothing", () => {
  const p = demo();
  const after = roundTrip(p, [{ t: "set", key: "a.two", lang: "fr", value: "Deux" }, { t: "set", key: "a.one", lang: "en", value: "1" }]);
  assert.equal(after.entries["a.two"].fr, "Deux");
  assert.equal(after.entries["a.one"].en, "1");
  assert.equal(ops.applyOp(p, { t: "set", key: "a.one", lang: "en", value: "1" }), null);
  assert.equal(ops.applyOp(p, { t: "set", key: "nope", lang: "en", value: "x" }), null);
});

test("addKeys / delKeys keep insertion order across undo", () => {
  const after = roundTrip(demo(), [{ t: "delKeys", keys: ["a.one", "b.three", "ghost"] }]);
  assert.deepEqual(Object.keys(after.entries), ["a.two", "b.four"]);
  const added = roundTrip(demo(), [{ t: "addKeys", items: [{ key: "c.new", entry: ops.newEntry({ en: "New" }) }, { key: "a.one", entry: ops.newEntry({ en: "dup" }) }] }]);
  assert.deepEqual(Object.keys(added.entries), ["a.one", "a.two", "b.three", "b.four", "c.new"]);
  assert.equal(added.entries["a.one"].en, "One", "existing keys are never overwritten by addKeys");
});

test("delete everything then undo", () => {
  const p = demo();
  const after = roundTrip(p, [{ t: "delKeys", keys: Object.keys(p.entries) }]);
  assert.deepEqual(after.entries, {});
});

test("renKey keeps position and pin", () => {
  const p = demo();
  const after = roundTrip(p, [{ t: "renKey", from: "a.two", to: "a.deux" }]);
  assert.deepEqual(Object.keys(after.entries), ["a.one", "a.deux", "b.three", "b.four"]);
  assert.deepEqual(after.pinned, ["a.deux"]);
  assert.equal(ops.applyOp(p, { t: "renKey", from: "a.deux", to: "a.one" }), null, "cannot rename onto an existing key");
});

test("addLang / delLang restore position and values", () => {
  const after = roundTrip(demo(), [{ t: "delLang", lang: "ja" }]);
  assert.deepEqual(after.languages, ["en", "fr"]);
  assert.equal(after.entries["a.one"].ja, undefined);
  const added = roundTrip(demo(), [{ t: "addLang", lang: "de", index: 1 }]);
  assert.deepEqual(added.languages, ["en", "de", "ja", "fr"]);
  assert.equal(ops.applyOp(demo(), { t: "addLang", lang: "en" }), null);
});

test("renLang moves values and follows the source language", () => {
  const p = demo();
  const after = roundTrip(p, [{ t: "renLang", from: "en", to: "en-us" }]);
  assert.deepEqual(after.languages, ["en-us", "ja", "fr"]);
  assert.equal(after.sourceLang, "en-us");
  assert.equal(after.entries["a.one"]["en-us"], "One");
  assert.equal(after.entries["a.one"].en, undefined);
  assert.equal(ops.applyOp(p, { t: "renLang", from: "en-us", to: "ja" }), null);
});

test("field ops and mixed transactions", () => {
  const p = demo();
  const after = roundTrip(p, [
    { t: "field", field: "name", value: "Renamed" },
    { t: "field", field: "pinned", value: [] },
    { t: "delKeys", keys: ["a.two"] },
    { t: "addLang", lang: "de" },
    { t: "addKeys", items: [{ key: "z", entry: ops.newEntry({ de: "Zett" }) }] },
    { t: "set", key: "z", lang: "en", value: "Zed" },
    { t: "renKey", from: "z", to: "zz" },
    { t: "delLang", lang: "fr" },
    { t: "field", field: "languages", value: ["de", "ja", "en"] },
  ]);
  assert.equal(after.name, "Renamed");
  assert.deepEqual(after.languages, ["de", "ja", "en"]);
  assert.deepEqual(after.entries.zz, { de: "Zett", en: "Zed" });
});

test("describeOps classifies changes", () => {
  assert.deepEqual(ops.describeOps([{ t: "set", key: "a", lang: "en", value: "x" }]).single, { t: "set", key: "a", lang: "en", value: "x" });
  assert.equal(ops.describeOps([{ t: "set", key: "a", lang: "en" }, { t: "set", key: "b", lang: "en" }]).single, null);
  assert.equal(ops.describeOps([{ t: "delKeys", keys: [] }]).structural, true);
  assert.equal(ops.describeOps([{ t: "field", field: "name", value: "x" }]).meta, true);
});

test("computeStats counts filled cells", () => {
  const s = ops.computeStats(demo());
  assert.equal(s.total, 4);
  assert.deepEqual(plain(s.filled), { en: 3, ja: 2, fr: 1 });
  assert.equal(s.complete, 1);
});

test("cloneProject is independent", () => {
  const p = demo();
  const c = ops.cloneProject(p);
  assert.notEqual(c.id, p.id);
  assert.equal(c.name, "Demo (copy)");
  c.entries["a.one"].en = "changed";
  assert.equal(p.entries["a.one"].en, "One");
  assert.notEqual(c.glossary[0].id, p.glossary[0].id);
});

test("sampleProject is well formed", () => {
  const p = ops.sampleProject();
  assert.deepEqual(p.languages, ["en", "ja", "fr", "de"]);
  const s = ops.computeStats(p);
  assert.equal(s.filled.en, s.total);
  assert.ok(s.filled.de < s.filled.fr && s.filled.fr < s.filled.ja);
});

/* ---------------------------------------------------------------- migration */

function v1State() {
  return {
    version: 1,
    settings: {
      theme: "light",
      cellDisplay: "wrap",
      aiProvider: "zai",
      openaiApiKey: "sk-old",
      openaiModel: "gpt-4o",
      zaiApiKey: "zk",
      zaiModel: "glm-4.6",
      defaultMaxChars: 40,
      defaultSourceLang: "ja",
      confirmDeletes: false,
      aiContext: "Fantasy RPG",
    },
    ui: { selectedProjectId: "p_2", visibleLangs: ["ja"], seenWelcome: true, listSortBy: "lang:ja", listSortDir: "desc", lockedKeys: ["battle.start", "gone"], colWidths: { ja: 300 } },
    projects: {
      p_1: { id: "p_1", name: "Site", languages: ["en", "fr"], entries: { "lp.hello": { en: "Hello", fr: "Bonjour" } }, meta: { createdAt: 1, updatedAt: 2 } },
      p_2: {
        id: "p_2",
        name: "Game",
        languages: ["ja", "en", "zhs"],
        entries: { "battle.start": { ja: "戦闘開始", en: "Battle start", zhs: "" }, "battle.end": { ja: "戦闘終了" } },
        translationRules: [{ sourceLang: "ja", targetLang: "zhs", from: "イル・ミナ", to: "伊尔·米娜" }, { from: "Lv.*", to: "Lv.*" }, { from: "", to: "x" }],
        meta: { createdAt: 3, updatedAt: 4 },
      },
    },
  };
}

test("fromV1 carries over settings, projects, rules and pins", () => {
  const s = migrate.fromV1(v1State());
  assert.equal(s.version, 2);
  assert.equal(s.settings.theme, "light");
  assert.equal(s.settings.density, "tall");
  assert.equal(s.settings.confirmDeletes, false);
  assert.equal(s.settings.ai.provider, "zai");
  assert.equal(s.settings.ai.providers.openai.apiKey, "sk-old");
  assert.equal(s.settings.ai.providers.openai.model, "gpt-4o");
  assert.equal(s.settings.ai.providers.zai.model, "glm-4.6");
  assert.equal(s.settings.ai.maxChars, 40);
  assert.equal(s.ui.selectedProjectId, "p_2");
  assert.equal(s.ui.seenWelcome, true);

  const game = s.projects.p_2;
  assert.deepEqual(game.languages, ["ja", "en", "zhs"]);
  assert.equal(game.sourceLang, "ja");
  assert.equal(game.context, "Fantasy RPG");
  assert.deepEqual(game.pinned, ["battle.start"]);
  assert.equal(game.glossary.length, 2);
  assert.deepEqual(plain(game.glossary[1]), Object.assign({ id: game.glossary[1].id }, { sourceLang: "all", targetLang: "all", from: "Lv.*", to: "Lv.*" }));
  assert.equal(ops.getValue(game, "battle.start", "en"), "Battle start");
  assert.equal(game.meta.createdAt, 3);

  const site = s.projects.p_1;
  assert.equal(site.sourceLang, "en", "falls back to the first language when the preferred source is missing");
  assert.deepEqual(site.pinned, []);

  assert.deepEqual(s.ui.views.p_2.visibleLangs, ["ja", "en", "zhs"]);
  assert.equal(s.ui.views.p_2.sortBy, "lang:ja");
  assert.equal(s.ui.views.p_2.sortDir, "desc");
});

test("fromV1 ignores an untouched starter project and broken data", () => {
  const pristine = {
    settings: {},
    ui: { seenWelcome: false },
    projects: { p: { id: "p", name: "Default Project", languages: ["en", "ja"], entries: { "lp.hello": { en: "Hello" }, "lp.bye": { en: "Good Bye" } } } },
  };
  assert.equal(migrate.fromV1(pristine), null);
  assert.equal(migrate.fromV1(null), null);
  assert.equal(migrate.fromV1({ projects: {} }), null);
  pristine.ui.seenWelcome = true;
  assert.ok(migrate.fromV1(pristine));
});

test("normalizeState repairs partial or hostile input", () => {
  const s = migrate.normalizeState({
    settings: { theme: "neon", density: "tall", ai: { provider: "nope", concurrency: 99, providers: { openai: { apiKey: 5, model: "m" } } } },
    ui: { selectedProjectId: "missing", views: { a: { visibleLangs: ["xx"], sortBy: "lang:zz", keyWidth: 99999, colWidths: { en: 5000, ja: 250 } } } },
    projects: { a: { name: "A", languages: ["en", "ja"], entries: { k: { en: "v" } } }, b: "garbage" },
  });
  assert.equal(s.settings.theme, "system");
  assert.equal(s.settings.density, "tall");
  assert.equal(s.settings.ai.provider, "openai");
  assert.equal(s.settings.ai.concurrency, 8);
  assert.equal(s.settings.ai.providers.openai.apiKey, "");
  assert.equal(s.settings.ai.providers.openai.model, "m");
  assert.equal(Object.keys(s.projects).length, 2);
  assert.equal(s.ui.selectedProjectId, "a");
  assert.deepEqual(s.ui.views.a.visibleLangs, ["en", "ja"]);
  assert.equal(s.ui.views.a.sortBy, "key");
  assert.equal(s.ui.views.a.keyWidth, 250);
  assert.deepEqual(s.ui.views.a.colWidths, { ja: 250 });
  assert.equal(migrate.emptyState().ui.selectedProjectId, null);
});

test("defaultView limits very wide projects to six columns including the source", () => {
  const langs = ["en", "ja", "fr", "de", "es", "it", "pt", "ko"];
  const p = ops.createProject({ languages: langs, sourceLang: "ko" });
  const v = migrate.defaultView(p);
  assert.equal(v.visibleLangs.length, 6);
  assert.ok(v.visibleLangs.includes("ko"));
});

test("mergeUnsavedCells re-applies only this tab's edited cells onto another tab's version", () => {
  const cell = (key, lang) => key + "\u0000" + lang;
  const local = ops.createProject({ name: "Local", languages: ["en", "fr", "de"], entries: { a: { en: "A", fr: "mine", de: "" }, b: { en: "B", fr: "", de: "local de" }, gone: { en: "x", fr: "y" } } });
  const remote = ops.createProject({ name: "Remote", languages: ["en", "fr"], entries: { a: { en: "A2", fr: "theirs" }, b: { en: "B", fr: "their b" }, c: { en: "C" } } });
  ops.mergeUnsavedCells(remote, local, [cell("a", "fr"), cell("b", "de"), cell("gone", "fr"), cell("c", "fr")]);
  assert.equal(remote.entries.a.fr, "mine", "an unsaved local edit wins for its own cell");
  assert.equal(remote.entries.a.en, "A2", "cells this tab did not touch keep the other tab's text");
  assert.equal(remote.entries.b.fr, "their b");
  assert.equal(remote.entries.b.de, undefined, "a language the other tab removed is not brought back");
  assert.equal(ops.hasKey(remote, "gone"), false, "a key the other tab deleted is not brought back");
  assert.deepEqual(plain(remote.entries.c), { en: "C" }, "a key that only exists remotely is left alone");
  assert.equal(remote.name, "Remote");

  // Clearing a cell locally is an edit too.
  const local2 = ops.createProject({ languages: ["en", "fr"], entries: { a: { en: "A", fr: "" } } });
  const remote2 = ops.createProject({ languages: ["en", "fr"], entries: { a: { en: "A", fr: "old" } } });
  ops.mergeUnsavedCells(remote2, local2, new Set([cell("a", "fr")]));
  assert.equal(remote2.entries.a.fr, "");
});

test("normalizeProject brings hand-written language codes to their stored form", () => {
  const p = ops.normalizeProject({
    name: "Hand edited",
    languages: ["EN", "pt_BR", "fr"],
    sourceLang: "EN",
    entries: {
      hello: { EN: "Hello", pt_BR: "Olá", fr: "Bonjour" },
      both: { EN: "upper", en: "lower", "pt-br": "", pt_BR: "kept" },
    },
    glossary: [{ from: "Hello", to: "Olá", sourceLang: "EN", targetLang: "pt_BR" }],
  });
  assert.deepEqual(p.languages, ["en", "pt-br", "fr"]);
  assert.equal(p.sourceLang, "en");
  assert.deepEqual(plain(p.entries.hello), { en: "Hello", "pt-br": "Olá", fr: "Bonjour" });
  assert.equal(p.entries.both.en, "lower", "an existing canonical value is not overwritten");
  assert.equal(p.entries.both["pt-br"], "kept", "an empty canonical value takes the other spelling's text");
  assert.equal(p.glossary[0].sourceLang, "en");
  assert.equal(p.glossary[0].targetLang, "pt-br");
  assert.equal(ops.computeStats(p).filled["pt-br"], 2);

  // Already-canonical projects are returned with the same values (the common path on every load).
  const again = ops.normalizeProject(plain(p));
  assert.deepEqual(plain(again.entries), plain(p.entries));
});
