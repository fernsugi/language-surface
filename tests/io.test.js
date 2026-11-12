const test = require("node:test");
const assert = require("node:assert/strict");
const LS = require("./_load.js");

const plain = (v) => JSON.parse(JSON.stringify(v));
const analyze = (name, text, ctx) => LS.importer.analyzeFile({ name, text }, ctx);

function project(init) {
  return LS.ops.createProject(Object.assign({ name: "Demo", languages: ["en", "ja"], entries: { "lp.hello": { en: "Hello", ja: "こんにちは" }, "lp.bye": { en: "Good Bye", ja: "" } } }, init));
}

/* ---------------------------------------------------------------- importer: JSON parsing */

test("parseJSON tolerates comments, trailing commas and BOM", () => {
  const text = '﻿{\n  // comment\n  "a": "x // not a comment",\n  /* block */ "url": "http://example.com/path",\n  "list": [1, 2,],\n}';
  assert.deepEqual(LS.importer.parseJSON(text), { a: "x // not a comment", url: "http://example.com/path", list: [1, 2] });
  assert.throws(() => LS.importer.parseJSON("{nope", "bad.json"), /Invalid JSON in bad\.json/);
});

/* ---------------------------------------------------------------- importer: detection */

test("CSV with key column and languages", () => {
  const src = analyze("demo.csv", "key,en,ja\nlp.hello,Hello,こんにちは\nlp.bye,Good Bye,さようなら\n");
  assert.equal(src.error, "");
  assert.equal(src.kind, "multi");
  assert.deepEqual(src.langs, ["en", "ja"]);
  assert.deepEqual(plain(src.entries), { "lp.hello": { en: "Hello", ja: "こんにちは" }, "lp.bye": { en: "Good Bye", ja: "さようなら" } });
});

test("CSV: Excel-style BOM + semicolons + locale columns", () => {
  const src = analyze("export.csv", "﻿Key;EN;pt_BR\na;Hello;Olá\n");
  assert.equal(src.error, "");
  assert.deepEqual(src.langs, ["en", "pt-br"]);
  assert.equal(src.entries.a["pt-br"], "Olá");
});

test("CSV errors and notes", () => {
  assert.match(analyze("x.csv", "key,en\n").error, /header row and at least one data row/);
  assert.match(analyze("x.csv", "key\na\n").error, /at least one language column/);
  const src = analyze("x.csv", "id,en,!!\na,Hello,zzz\n");
  assert.equal(src.error, "");
  assert.ok(src.notes.some((n) => /not a usable language code/.test(n)));
});

test("JSON: flat multi-language map", () => {
  const src = analyze("all.json", JSON.stringify({ "lp.hello": { en: "Hello", ja: "こんにちは" }, "lp.bye": { en: "Bye" } }));
  assert.equal(src.kind, "multi");
  assert.equal(src.layout, "key-first");
  assert.deepEqual(src.langs, ["en", "ja"]);
  assert.equal(src.keyCount, 2);
});

test("JSON: nested multi-language map (the app's own single-file export)", () => {
  const src = analyze("project.json", JSON.stringify({ lp: { hello: { en: "Hello", ja: "こんにちは" }, bye: { en: "Good Bye", ja: "さようなら" } } }));
  assert.equal(src.kind, "multi");
  assert.deepEqual(Object.keys(src.entries), ["lp.hello", "lp.bye"]);
  assert.equal(src.entries["lp.bye"].ja, "さようなら");
});

test("JSON: language-first map", () => {
  const src = analyze("messages.json", JSON.stringify({ en: { nav: { home: "Home", ok: "OK", no: "No" } }, ja: { nav: { home: "ホーム", ok: "OK", no: "いいえ" } } }));
  assert.equal(src.kind, "multi");
  assert.equal(src.layout, "lang-first");
  assert.deepEqual(src.langs, ["en", "ja"]);
  assert.equal(src.entries["nav.home"].ja, "ホーム");
  assert.equal(src.entries["nav.no"].en, "No");
});

test("JSON: short namespaces are not mistaken for languages", () => {
  const src = analyze("en.json", JSON.stringify({ hp: { max: "Max HP" }, ok: { label: "OK" }, it: { works: "It works" } }));
  assert.equal(src.kind, "single");
  assert.equal(src.lang, "en");
  assert.deepEqual(Object.keys(src.values), ["hp.max", "ok.label", "it.works"]);
});

test("JSON: single language nested file with arrays", () => {
  const src = analyze("ja.json", JSON.stringify({ common: { cancel: "キャンセル", count: 3, flag: true, none: null }, list: ["a", "b"] }));
  assert.equal(src.kind, "single");
  assert.equal(src.lang, "ja");
  assert.equal(src.langSource, "filename");
  assert.deepEqual(plain(src.values), { "common.cancel": "キャンセル", "common.count": "3", "common.flag": "true", "common.none": "", "list[0]": "a", "list[1]": "b" });
});

test("JSON: root language wrapper is unwrapped", () => {
  const a = analyze("strings.json", JSON.stringify({ fr: { title: "Titre" } }));
  assert.equal(a.kind, "single");
  assert.equal(a.lang, "fr");
  assert.equal(a.langSource, "wrapper");
  assert.deepEqual(plain(a.values), { title: "Titre" });
  // A file-name language that disagrees keeps the root key as a namespace.
  const b = analyze("en.json", JSON.stringify({ it: { title: "Title" } }));
  assert.equal(b.lang, "en");
  assert.deepEqual(plain(b.values), { "it.title": "Title" });
});

test("JSON: unknown file name falls back to the default language", () => {
  const src = analyze("strings.json", JSON.stringify({ title: "Hello" }), { defaultLang: "de" });
  assert.equal(src.lang, "de");
  assert.equal(src.langSource, "default");
});

test("JSON: interpretation can be switched", () => {
  const src = analyze("all.json", JSON.stringify({ title: { en: "A", ja: "B" } }), { defaultLang: "en" });
  assert.equal(src.kind, "multi");
  LS.importer.setJSONKind(src, "single", "en");
  assert.equal(src.kind, "single");
  assert.deepEqual(plain(src.values), { title: "A" });
  LS.importer.setJSONKind(src, "multi", "en");
  assert.equal(src.kind, "multi");
});

test("JSON: mixed files report skipped values", () => {
  const src = analyze("all.json", JSON.stringify({ title: { en: "A", ja: "B" }, version: "1.0" }));
  assert.equal(src.kind, "multi");
  assert.ok(src.notes.some((n) => /1 value outside a language map was skipped/.test(n)));
});

test("JSON errors", () => {
  assert.match(analyze("x.json", "[]").error, /No translatable strings/);
  assert.match(analyze("x.json", '"text"').error, /root must be an object/);
  assert.match(analyze("x.json", "{bad").error, /Invalid JSON/);
  assert.match(analyze("x.json", "{}").error, /No translatable strings/);
});

test("JSON: __proto__ keys are ignored safely", () => {
  const src = analyze("en.json", '{"__proto__": "x", "ok": "fine", "constructor": "c"}');
  assert.deepEqual(Object.keys(src.values).sort(), ["constructor", "ok"]);
  assert.equal({}.x, undefined);
});

test("text files become numbered keys", () => {
  const src = analyze("lines.txt", "First line\r\n\r\n  Second line  \n");
  assert.equal(src.kind, "lines");
  assert.deepEqual(src.lines, ["First line", "Second line"]);
  src.lang = "en";
  src.prefix = "item";
  const plan = LS.importer.buildPlan([src]);
  assert.deepEqual(plain(plan.entries), { item_1: { en: "First line" }, item_2: { en: "Second line" } });
  assert.match(analyze("empty.txt", "\n \n").error, /empty/);
});

/* ---------------------------------------------------------------- importer: plan */

test("buildPlan merges several per-language files", () => {
  const en = analyze("en.json", JSON.stringify({ a: { b: "Hello" }, only: "EN" }));
  const ja = analyze("ja.json", JSON.stringify({ a: { b: "こんにちは" } }));
  const plan = LS.importer.buildPlan([en, ja]);
  assert.deepEqual(plan.langs, ["en", "ja"]);
  assert.deepEqual(plain(plan.entries), { "a.b": { en: "Hello", ja: "こんにちは" }, only: { en: "EN" } });
  assert.deepEqual(plan.problems, []);
});

test("buildPlan reports sources without a language and skips broken ones", () => {
  const src = analyze("strings.json", JSON.stringify({ title: "Hello" }));
  src.lang = "";
  const broken = analyze("bad.json", "{");
  const plan = LS.importer.buildPlan([src, broken]);
  assert.equal(plan.keyCount, 0);
  assert.equal(plan.problems.length, 1);
});

test("summarize and planChanges respect the merge mode", () => {
  const p = project();
  const src = analyze("in.csv", "key,en,ja,fr\nlp.hello,Hi,,Salut\nlp.bye,Good Bye,さようなら,\nlp.new,New,,\n");
  const plan = LS.importer.buildPlan([src]);

  const over = LS.importer.summarize(p, plan, "overwrite");
  assert.deepEqual(over, { newKeys: 1, existingKeys: 2, newLangs: ["fr"], filled: 3, replaced: 1, kept: 0, unchanged: 1 });
  const keep = LS.importer.summarize(p, plan, "keep");
  assert.equal(keep.replaced, 0);
  assert.equal(keep.kept, 1);

  const changes = LS.importer.planChanges(p, plan, "overwrite");
  assert.deepEqual(changes.addKeys, ["lp.new"]);
  assert.deepEqual(changes.addLangs, ["fr"]);
  // Empty incoming cells never erase existing text (ja stays "こんにちは").
  assert.ok(!changes.changes.some((c) => c.key === "lp.hello" && c.lang === "ja"));
  assert.ok(changes.changes.some((c) => c.key === "lp.hello" && c.lang === "en" && c.value === "Hi"));
  const keepChanges = LS.importer.planChanges(p, plan, "keep");
  assert.ok(!keepChanges.changes.some((c) => c.key === "lp.hello" && c.lang === "en"));
});

/* ---------------------------------------------------------------- exporter */

test("CSV export matches the original format and round-trips", () => {
  const p = project({ entries: { "b.key": { en: 'Say "hi", ok', ja: "やあ" }, "a.key": { en: "multi\nline", ja: "" } } });
  const csv = LS.exporter.toCSV(p, { sort: true });
  assert.equal(csv, 'key,en,ja\na.key,"multi\nline",\nb.key,"Say ""hi"", ok",やあ');
  const back = analyze("demo.csv", csv);
  assert.deepEqual(plain(back.entries), { "a.key": { en: "multi\nline", ja: "" }, "b.key": { en: 'Say "hi", ok', ja: "やあ" } });
});

test("single JSON export nests keys and round-trips", () => {
  const p = project();
  const { content, conflicts } = LS.exporter.toJSONMap(p, {});
  assert.deepEqual(conflicts, []);
  assert.deepEqual(JSON.parse(content), { lp: { hello: { en: "Hello", ja: "こんにちは" }, bye: { en: "Good Bye", ja: "" } } });
  assert.ok(content.endsWith("\n"));
  const back = analyze("demo.json", content);
  assert.equal(back.kind, "multi");
  assert.deepEqual(Object.keys(back.entries), ["lp.hello", "lp.bye"]);
});

test("per-language JSON export: names, nesting, flat option", () => {
  const p = project({ name: "My App" });
  const nested = LS.exporter.toJSONPerLang(p, {});
  assert.deepEqual(nested.files.map((f) => f.name), ["en.json", "ja.json"]);
  assert.deepEqual(JSON.parse(nested.files[0].content), { lp: { hello: "Hello", bye: "Good Bye" } });
  assert.deepEqual(JSON.parse(nested.files[1].content), { lp: { hello: "こんにちは", bye: "" } });
  const named = LS.exporter.toJSONPerLang(p, { naming: "project", nested: false, langs: ["ja"] });
  assert.deepEqual(named.files.map((f) => f.name), ["My_App_ja.json"]);
  assert.deepEqual(JSON.parse(named.files[0].content), { "lp.hello": "こんにちは", "lp.bye": "" });
});

test("export keeps conflicting keys under their flat name", () => {
  const p = project({ entries: { menu: { en: "Menu" }, "menu.title": { en: "Title" } } });
  const res = LS.exporter.toJSONPerLang(p, { langs: ["en"] });
  assert.deepEqual(res.conflicts, ["menu.title"]);
  assert.deepEqual(JSON.parse(res.files[0].content), { menu: "Menu", "menu.title": "Title" });
  const back = analyze("en.json", res.files[0].content);
  assert.deepEqual(Object.keys(back.values).sort(), ["menu", "menu.title"]);
});

test("export rebuilds arrays so JSON files round-trip", () => {
  const original = { list: ["a", "b"], deep: { rows: [{ title: "x" }, { title: "y" }] } };
  const src = analyze("en.json", JSON.stringify(original));
  const p = LS.ops.createProject({ name: "A", languages: ["en"], entries: LS.importer.buildPlan([src]).entries });
  const out = LS.exporter.toJSONPerLang(p, {});
  assert.deepEqual(JSON.parse(out.files[0].content), original);
});

test("export subsets: languages, keys, code style", () => {
  const p = project({ languages: ["en", "pt-br"], entries: { a: { en: "A", "pt-br": "Á" }, b: { en: "B" } } });
  const built = LS.exporter.build(p, { format: "json-per-lang", keys: ["b"], codeStyle: "bcp47" });
  assert.deepEqual(built.files.map((f) => f.name), ["en.json", "pt-BR.json"]);
  assert.equal(built.keyCount, 1);
  assert.deepEqual(JSON.parse(built.files[1].content), { b: "" });
  assert.equal(LS.exporter.toCSV(p, { langs: ["pt-br"], codeStyle: "underscore", sort: true }), "key,pt_BR\na,Á\nb,");
  assert.equal(LS.exporter.build(p, { format: "csv" }).files[0].name, "Demo.csv");
});

/* ---------------------------------------------------------------- zip */

test("zip.create writes a readable stored archive", () => {
  const files = [
    { name: "en.json", content: '{"a":"Hello"}\n' },
    { name: "日本語/ja.json", content: '{"a":"こんにちは"}\n' },
  ];
  const zip = LS.zip.create(files, new Date(2026, 0, 2, 3, 4, 6));
  const view = new DataView(zip.buffer);
  const dec = new TextDecoder();

  // End of central directory record
  const eocd = zip.length - 22;
  assert.equal(view.getUint32(eocd, true), 0x06054b50);
  assert.equal(view.getUint16(eocd + 10, true), 2);
  let pos = view.getUint32(eocd + 16, true);

  for (const file of files) {
    assert.equal(view.getUint32(pos, true), 0x02014b50);
    const crc = view.getUint32(pos + 16, true);
    const size = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true);
    const localOffset = view.getUint32(pos + 42, true);
    assert.equal(dec.decode(zip.subarray(pos + 46, pos + 46 + nameLen)), file.name);

    assert.equal(view.getUint32(localOffset, true), 0x04034b50);
    const localNameLen = view.getUint16(localOffset + 26, true);
    const dataStart = localOffset + 30 + localNameLen;
    const data = zip.subarray(dataStart, dataStart + size);
    assert.equal(dec.decode(data), file.content);
    assert.equal(LS.zip.crc32(data), crc);
    pos += 46 + nameLen;
  }
  assert.equal(LS.zip.crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});
