// Loads the browser modules into Node (they attach to globalThis.LS) for unit testing.
// Run all tests with:  node --test
const path = require("node:path");

const files = [
  "core/util.js",
  "core/langs.js",
  "core/keys.js",
  "core/csv.js",
  "core/text.js",
  "core/importer.js",
  "core/exporter.js",
  "core/zip.js",
  "core/ai.js",
  "store/migrate.js",
  "store/ops.js",
];

for (const f of files) require(path.join(__dirname, "..", "js", f));

module.exports = globalThis.LS;
