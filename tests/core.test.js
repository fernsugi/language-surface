const test = require("node:test");
const assert = require("node:assert/strict");
const LS = require("./_load.js");

const plain = (v) => JSON.parse(JSON.stringify(v));

/* ---------------------------------------------------------------- langs */

test("langs.normalize canonicalizes codes", () => {
  assert.equal(LS.langs.normalize(" EN "), "en");
  assert.equal(LS.langs.normalize("pt_BR"), "pt-br");
  assert.equal(LS.langs.normalize("zh-Hans"), "zh-hans");
  assert.equal(LS.langs.normalize("fr ca!"), "frca");
  assert.equal(LS.langs.normalize(""), "");
  assert.equal(LS.langs.normalize(null), "");
});

test("langs.bcp47 / label / formatCode", () => {
  assert.equal(LS.langs.bcp47("pt-br"), "pt-BR");
  assert.equal(LS.langs.bcp47("zh-hans"), "zh-Hans");
  assert.equal(LS.langs.bcp47("es-419"), "es-419");
  assert.equal(LS.langs.label("pt-br"), "PT-BR");
  assert.equal(LS.langs.formatCode("pt-br", "underscore"), "pt_BR");
  assert.equal(LS.langs.formatCode("pt-br", "lower"), "pt-br");
});

test("langs.name resolves known, regional and unknown codes", () => {
  assert.equal(LS.langs.name("ja"), "Japanese");
  assert.equal(LS.langs.name("pt-br"), "Portuguese (Brazil)");
  assert.equal(LS.langs.name("zh-hans"), "Chinese (Simplified)");
  assert.equal(LS.langs.name("zhs"), "");
  assert.equal(LS.langs.displayName("zhs"), "ZHS");
  assert.ok(LS.langs.name("en-nz").length > 0);
});

test("langs.search ranks code matches first and honours exclusions", () => {
  const hits = LS.langs.search("ja");
  assert.equal(hits[0].code, "ja");
  assert.ok(LS.langs.search("portu").some((h) => h.code === "pt"));
  assert.ok(!LS.langs.search("ja", { exclude: ["ja"] }).some((h) => h.code === "ja"));
  assert.ok(LS.langs.search("").length > 0);
});

test("langs detection heuristics", () => {
  assert.ok(LS.langs.looksLikeLangCode("en"));
  assert.ok(LS.langs.looksLikeLangCode("zh-Hans"));
  assert.ok(LS.langs.looksLikeLangCode("zh_CN"));
  assert.ok(!LS.langs.looksLikeLangCode("is_ok"));
  assert.ok(!LS.langs.looksLikeLangCode("hello"));
  assert.ok(LS.langs.looksLikeLangMapKeys(["en", "ja"]));
  assert.ok(LS.langs.looksLikeLangMapKeys(["en", "zhs", "zht"]));
  assert.ok(!LS.langs.looksLikeLangMapKeys(["hp", "ok", "top"]));
  assert.ok(!LS.langs.looksLikeLangMapKeys(["en", "title"]));
  assert.ok(!LS.langs.looksLikeLangMapKeys([]));
});

test("langs.inferFromFileName", () => {
  assert.equal(LS.langs.inferFromFileName("en.json"), "en");
  assert.equal(LS.langs.inferFromFileName("project_ja.json"), "ja");
  assert.equal(LS.langs.inferFromFileName("my-app-fr.json"), "fr");
  assert.equal(LS.langs.inferFromFileName("app_pt-BR.json"), "pt-br");
  assert.equal(LS.langs.inferFromFileName("messages_zh_CN.json"), "zh-cn");
  assert.equal(LS.langs.inferFromFileName("translation.en.json"), "en");
  assert.equal(LS.langs.inferFromFileName("zhs.json"), "zhs");
  assert.equal(LS.langs.inferFromFileName("fr-ca.json"), "fr-ca");
  assert.equal(LS.langs.inferFromFileName("common.json"), "");
  assert.equal(LS.langs.inferFromFileName("translations.json"), "");
  assert.equal(LS.langs.inferFromFileName("to-do-fr.json"), "fr");
  assert.equal(LS.langs.inferFromFileName("project-it-en.json"), "en");
  assert.equal(LS.langs.inferFromFileName("zh-Hans-CN.json"), "zh-hans-cn");
  assert.equal(LS.langs.inferFromFileName("locales/zh_Hant.json"), "zh-hant");
  assert.equal(LS.langs.inferFromFileName("app.json"), "");
});

test("langs.isRtl and htmlLang", () => {
  assert.ok(LS.langs.isRtl("ar"));
  assert.ok(LS.langs.isRtl("he-il"));
  assert.ok(!LS.langs.isRtl("ja"));
  assert.equal(LS.langs.htmlLang("zh-hant"), "zh-Hant");
  assert.equal(LS.langs.htmlLang("zhs"), "");
});

/* ---------------------------------------------------------------- keys */

test("keys.normalizeKey and splitKey", () => {
  assert.equal(LS.keys.normalizeKey("  a.b   c "), "a.b c");
  assert.deepEqual(LS.keys.splitKey("auth.errors.invalid"), { ns: "auth.errors.", leaf: "invalid" });
  assert.deepEqual(LS.keys.splitKey("title"), { ns: "", leaf: "title" });
  assert.equal(LS.keys.namespaceOf("auth.errors.invalid"), "auth.errors");
  assert.equal(LS.keys.namespaceOf("title"), "");
});

test("keys.parsePath handles array indexes", () => {
  assert.deepEqual(LS.keys.parsePath("a.b.c"), ["a", "b", "c"]);
  assert.deepEqual(LS.keys.parsePath("items[0].name"), ["items", 0, "name"]);
  assert.deepEqual(LS.keys.parsePath("grid[1][2]"), ["grid", 1, 2]);
  assert.deepEqual(LS.keys.parsePath("[0]"), [0]);
  assert.deepEqual(LS.keys.parsePath("a..b"), ["a", "b"]);
});

test("keys.nest builds nested objects and arrays", () => {
  const { tree, conflicts } = LS.keys.nest({ "lp.hello": "Hello", "lp.bye": "Bye", "items[0]": "a", "items[1]": "b", top: "x" });
  assert.deepEqual(plain(tree), { lp: { hello: "Hello", bye: "Bye" }, items: ["a", "b"], top: "x" });
  assert.deepEqual(conflicts, []);
});

test("keys.nest keeps a key that is also a namespace, whatever the key order", () => {
  const a = LS.keys.nest({ menu: "Menu", "menu.title": "Title", "menu.items": "Items" });
  assert.deepEqual(plain(a.tree), { menu: "Menu" });
  assert.deepEqual(a.conflicts, ["menu.title", "menu.items"]);
  // Same keys, namespace members first: the result must be identical.
  const b = LS.keys.nest({ "menu.title": "Title", "menu.items": "Items", menu: "Menu" });
  assert.deepEqual(plain(b.tree), { menu: "Menu" });
  assert.deepEqual(b.conflicts.sort(), ["menu.items", "menu.title"]);
  assert.deepEqual(LS.keys.nestingConflicts(["a", "a.b", "c"]), ["a.b"]);
  assert.deepEqual(LS.keys.nestingConflicts(["a[0]", "a[1]", "a"]).sort(), ["a[0]", "a[1]"]);
  assert.deepEqual(LS.keys.nestingConflicts(["a.b.c", "a.b", "a"]).sort(), ["a.b", "a.b.c"]);
});

test("keys.nest never renames or drops keys with empty segments", () => {
  const { tree, conflicts } = LS.keys.nest({ "Loading...": 1, "Saved.": 2, "...": 3, ".x": 4, "": 5, ok: 6, "a..b": 7 });
  assert.deepEqual(plain(tree), { ok: 6 });
  assert.deepEqual(conflicts.sort(), ["", "...", ".x", "Loading...", "Saved.", "a..b"]);
});

test("keys.nest reports a second key that resolves to the same path", () => {
  const { tree, conflicts } = LS.keys.nest({ "list[0]": "a", "list[00]": "b" });
  assert.deepEqual(plain(tree), { list: ["a"] });
  assert.deepEqual(conflicts, ["list[00]"]);
});

test("keys.nest keeps object leaves (language maps) intact and is prototype-safe", () => {
  const { tree } = LS.keys.nest({ "a.b": { en: "x", ja: "y" }, "__proto__.polluted": "no", "constructor.x": "ok" });
  assert.deepEqual(plain(tree).a, { b: { en: "x", ja: "y" } });
  assert.equal({}.polluted, undefined);
  assert.equal(plain(tree).constructor.x, "ok");
});

test("keys.nest fills sparse arrays", () => {
  const { tree } = LS.keys.nest({ "list[0]": "a", "list[2]": "c" });
  assert.deepEqual(plain(tree), { list: ["a", "", "c"] });
});

test("keys.namespaceTree counts keys per namespace", () => {
  const root = LS.keys.namespaceTree(["a.b.c", "a.b.d", "a.e", "f", "g.h"]);
  assert.equal(root.count, 5);
  assert.deepEqual(root.children.map((n) => [n.path, n.count]), [["a", 3], ["g", 1]]);
  assert.deepEqual(root.children[0].children.map((n) => [n.path, n.count]), [["a.b", 2]]);
});

test("keys.inNamespace matches whole segments only", () => {
  assert.ok(LS.keys.inNamespace("auth.login", "auth"));
  assert.ok(!LS.keys.inNamespace("authz.login", "auth"));
  assert.ok(!LS.keys.inNamespace("auth", "auth"));
  assert.ok(LS.keys.inNamespace("anything", ""));
});

/* ---------------------------------------------------------------- csv */

test("csv.parse handles quotes, embedded newlines and CRLF", () => {
  const { rows } = LS.csv.parse('key,en,ja\r\nlp.hello,"Hello, ""world""",こんにちは\r\nlp.multi,"line1\nline2",\r\n\r\n');
  assert.deepEqual(rows, [
    ["key", "en", "ja"],
    ["lp.hello", 'Hello, "world"', "こんにちは"],
    ["lp.multi", "line1\nline2", ""],
  ]);
});

test("csv.parse strips BOM and detects delimiters", () => {
  assert.deepEqual(LS.csv.parse("﻿key;en;de\na;Hello;Hallo").rows, [["key", "en", "de"], ["a", "Hello", "Hallo"]]);
  assert.equal(LS.csv.parse("key\ten\na\tb").delimiter, "\t");
  assert.equal(LS.csv.parse('key,en\n"a;b",c').delimiter, ",");
});

test("csv.parse treats quotes inside unquoted fields as text", () => {
  const { rows } = LS.csv.parse('key,en,ja\nhint,Click "OK" to continue,OK\nsize,5" screen,5インチ\nnext,after,後\nlead, "spaced, quoted",x\nq,"a ""b"" c",y');
  assert.deepEqual(rows, [
    ["key", "en", "ja"],
    ["hint", 'Click "OK" to continue', "OK"],
    ["size", '5" screen', "5インチ"],
    ["next", "after", "後"],
    ["lead", "spaced, quoted", "x"],
    ["q", 'a "b" c', "y"],
  ]);
});

test("csv.stringify round-trips through parse", () => {
  const rows = [["key", "en"], ["a", 'He said "hi", ok'], ["b", "multi\nline"], ["c", " padded "], ["d", ""]];
  const text = LS.csv.stringify(rows);
  assert.deepEqual(LS.csv.parse(text).rows, rows);
  assert.ok(LS.csv.stringify(rows, { bom: true }).startsWith("﻿"));
});

/* ---------------------------------------------------------------- text */

test("text.placeholders finds common placeholder styles", () => {
  assert.deepEqual(LS.text.placeholders("Hi {name}, you have %d items and {{count}} more ${x}"), ["{name}", "%d", "{{count}}", "${x}"]);
  assert.deepEqual(LS.text.placeholders("Use %1$s and %2$d, 100% sure"), ["%1$s", "%2$d"]);
  assert.deepEqual(LS.text.placeholders("<b>Bold</b><br/><color=#fff>x</color>"), ["<b>", "</b>", "<br/>", "<color=#fff>", "</color>"]);
  assert.deepEqual(LS.text.placeholders("50 % des articles, a < b and c > d"), []);
  assert.deepEqual(LS.text.placeholders("plain text"), []);
});

test("text.comparePlaceholders reports missing and extra tokens", () => {
  assert.deepEqual(LS.text.comparePlaceholders("Hello {name}", "こんにちは {name}"), { missing: [], extra: [] });
  assert.deepEqual(LS.text.comparePlaceholders("{count} of {total}", "{count}"), { missing: ["{total}"], extra: [] });
  assert.deepEqual(LS.text.comparePlaceholders("Hi", "Hi {x}"), { missing: [], extra: ["{x}"] });
  assert.deepEqual(LS.text.comparePlaceholders("%s %s", "%s"), { missing: ["%s"], extra: [] });
});

test("text.checkTranslation flags placeholder, spacing and length problems", () => {
  assert.deepEqual(LS.text.checkTranslation("Hello {name}", "Bonjour {name}"), []);
  assert.equal(LS.text.checkTranslation("Hello {name}", "Bonjour")[0].type, "placeholder");
  assert.equal(LS.text.checkTranslation("Hello", "Bonjour ")[0].type, "space");
  assert.equal(LS.text.checkTranslation("Hello", "Bonjour tout le monde", { maxChars: 5 })[0].type, "length");
  assert.deepEqual(LS.text.checkTranslation("Hello {name}", ""), []);
});

test("text.relevantRules filters by language pair and occurrence", () => {
  const rules = [
    { sourceLang: "en", targetLang: "ja", from: "sword", to: "剣" },
    { sourceLang: "en", targetLang: "fr", from: "sword", to: "épée" },
    { sourceLang: "all", targetLang: "all", from: "Lv.*", to: "Lv.*" },
    { sourceLang: "en", targetLang: "ja", from: "shield", to: "盾" },
  ];
  const hit = LS.text.relevantRules(rules, "en", "ja", "A rusty SWORD (Lv.3)");
  assert.deepEqual(hit.map((r) => r.to), ["剣", "Lv.*"]);
  assert.deepEqual(LS.text.relevantRules(rules, "en", "ja", "Nothing here"), []);
});

test("text.finder counts, replaces and splits", () => {
  const f = LS.text.finder("cat", { matchCase: false });
  assert.equal(f.count("Cat concat CAT"), 3);
  assert.equal(f.replace("Cat concat", "dog"), "dog condog");
  assert.deepEqual(f.pieces("a cat b"), ["a ", "cat", " b"]);
  const g = LS.text.finder("a.b", { matchCase: true });
  assert.equal(g.count("a.b axb A.B"), 1);
  assert.equal(LS.text.finder("$1", { matchCase: true }).replace("cost $1", "$&"), "cost $&");
});

test("text.tokenizeInvisibles exposes line breaks and tabs", () => {
  assert.deepEqual(LS.text.tokenizeInvisibles("a\nb\tc\r\nd"), [
    { t: "text", v: "a" },
    { t: "nl", v: "\n" },
    { t: "text", v: "b" },
    { t: "tab", v: "\t" },
    { t: "text", v: "c" },
    { t: "nl", v: "\n" },
    { t: "text", v: "d" },
  ]);
});

/* ---------------------------------------------------------------- util */

test("util helpers", () => {
  assert.equal(LS.util.plural(1, "key"), "1 key");
  assert.equal(LS.util.plural(2, "key"), "2 keys");
  assert.equal(LS.util.plural(3, "entry", "entries"), "3 entries");
  assert.equal(LS.util.completion(0, 10), 0);
  assert.equal(LS.util.completion(999, 1000), 99);
  assert.equal(LS.util.completion(1, 1000), 1);
  assert.equal(LS.util.completion(10, 10), 100);
  assert.equal(LS.util.completion(0, 0), 100);
  assert.equal(LS.util.safeFileName("My Project! (v2)"), "My_Project_v2");
  assert.equal(LS.util.safeFileName("///"), "project");
  assert.equal(LS.util.charCount("héllo"), 5);
  assert.equal(LS.util.charCount("👨‍👩‍👧 ok"), 4);
  assert.deepEqual(["item_10", "item_2", "item_1"].sort(LS.util.natCompare), ["item_1", "item_2", "item_10"]);
});
