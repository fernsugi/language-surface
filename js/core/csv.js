/* Language Surface — CSV parsing and serialization (RFC 4180-style, delimiter auto-detection). */
(function (LS) {
  "use strict";

  const DELIMITERS = [",", ";", "\t", "|"];

  /** Guess the delimiter from the header line (ignoring anything inside quotes). */
  function detectDelimiter(text) {
    const counts = { ",": 0, ";": 0, "\t": 0, "|": 0 };
    let inQuotes = false;
    let seen = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        inQuotes = !inQuotes;
        seen = true;
      } else if (!inQuotes) {
        if (c === "\n") {
          if (seen) break;
          continue;
        }
        if (c in counts) counts[c]++;
        if (c !== "\r" && c !== " ") seen = true;
      }
    }
    let best = ",";
    for (const d of DELIMITERS) if (counts[d] > counts[best]) best = d;
    return best;
  }

  /**
   * Parse CSV text into rows of string fields. Blank rows are skipped.
   * @param {string} text
   * @param {{delimiter?: string}} [opts]
   * @returns {{rows: string[][], delimiter: string}}
   */
  function parse(text, opts) {
    const src = LS.util.stripBom(String(text == null ? "" : text));
    const delimiter = (opts && opts.delimiter) || detectDelimiter(src);
    const rows = [];
    let field = "";
    let row = [];
    let inQuotes = false;
    const pushRow = () => {
      row.push(field);
      field = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    };
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (inQuotes) {
        if (c === '"') {
          if (src[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += c;
        }
        continue;
      }
      if (c === '"') inQuotes = true;
      else if (c === delimiter) {
        row.push(field);
        field = "";
      } else if (c === "\n") pushRow();
      else if (c === "\r") {
        // Lone CR (classic Mac) ends a row; CRLF is handled by the LF.
        if (src[i + 1] !== "\n") pushRow();
      } else field += c;
    }
    pushRow();
    return { rows, delimiter };
  }

  function escapeField(value, delimiter) {
    const s = String(value == null ? "" : value);
    if (s === "") return "";
    if (s.includes('"') || s.includes(delimiter) || s.includes("\n") || s.includes("\r") || /^\s|\s$/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  /**
   * Serialize rows to CSV.
   * @param {Array<Array<any>>} rows
   * @param {{delimiter?: string, bom?: boolean, eol?: string}} [opts]
   */
  function stringify(rows, opts) {
    const o = opts || {};
    const delimiter = o.delimiter || ",";
    const eol = o.eol || "\n";
    const body = rows.map((r) => r.map((v) => escapeField(v, delimiter)).join(delimiter)).join(eol);
    return (o.bom ? "﻿" : "") + body;
  }

  LS.csv = { parse, stringify, detectDelimiter };
})(globalThis.LS || (globalThis.LS = {}));
