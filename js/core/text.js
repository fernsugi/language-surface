/* Language Surface — text helpers: placeholders, quality checks, glossary matching, find & replace. */
(function (LS) {
  "use strict";

  const { escapeRegExp, charCount } = LS.util;

  /* ---- Placeholders ----------------------------------------------------- */

  const PLACEHOLDER_PARTS = [
    /\{\{\s*[\w.\-]+\s*\}\}/, // {{var}}
    /\$\{[^{}\n]+\}/, // ${var}
    /\{\s*[\w.\-]+\s*\}/, // {name} {0}
    /%(?:\d+\$)?[-+0#]*\d*(?:\.\d+)?(?:hh|h|ll|l|L|z|j|t)?[sdifFeEgGxXoucCpaA@]/, // %s %d %1$s %.2f %@
    /<\/?[A-Za-z][\w\-]*(?:=[^<>\s]*)?(?:\s+[\w\-:]+=(?:"[^"]*"|'[^']*'|[^\s<>]*))*\s*\/?>/, // <b> </b> <br/> <color=#fff>
    /<\/?\d+\/?>/, // <0> </0> (component placeholders)
  ];
  const PLACEHOLDER_RE = new RegExp(PLACEHOLDER_PARTS.map((r) => r.source).join("|"), "g");

  /** List the placeholders / markup tokens found in a string, in order. */
  function placeholders(text) {
    const s = String(text == null ? "" : text);
    if (!s || !/[{%<$]/.test(s)) return [];
    const out = s.match(PLACEHOLDER_RE) || [];
    return out.map((t) => t.replace(/\s+/g, " "));
  }

  /**
   * Compare placeholders between a source string and its translation.
   * @returns {{missing: string[], extra: string[]}} tokens missing from / unexpected in the translation
   */
  function comparePlaceholders(source, target) {
    const a = placeholders(source);
    const b = placeholders(target);
    if (!a.length && !b.length) return { missing: [], extra: [] };
    const count = (list) => {
      const m = new Map();
      for (const t of list) m.set(t, (m.get(t) || 0) + 1);
      return m;
    };
    const ca = count(a);
    const cb = count(b);
    const missing = [];
    const extra = [];
    for (const [t, n] of ca) for (let i = cb.get(t) || 0; i < n; i++) missing.push(t);
    for (const [t, n] of cb) for (let i = ca.get(t) || 0; i < n; i++) extra.push(t);
    return { missing, extra };
  }

  /**
   * Quality checks for one translation against its source text.
   * @returns {{type: string, message: string}[]} empty when everything looks fine
   */
  function checkTranslation(source, target, opts) {
    const issues = [];
    const src = String(source == null ? "" : source);
    const tgt = String(target == null ? "" : target);
    if (!tgt) return issues;
    if (src) {
      const { missing, extra } = comparePlaceholders(src, tgt);
      if (missing.length) issues.push({ type: "placeholder", message: "Missing " + missing.join(", ") });
      if (extra.length) issues.push({ type: "placeholder", message: "Unexpected " + extra.join(", ") });
      const srcLead = /^\s/.test(src);
      const srcTrail = /\s$/.test(src);
      if (/^\s/.test(tgt) && !srcLead) issues.push({ type: "space", message: "Starts with a space" });
      if (/\s$/.test(tgt) && !srcTrail) issues.push({ type: "space", message: "Ends with a space" });
    }
    const max = opts && Number(opts.maxChars);
    if (max > 0 && charCount(tgt) > max) issues.push({ type: "length", message: "Longer than " + max + " characters" });
    return issues;
  }

  /* ---- Invisible characters ---------------------------------------------- */

  /**
   * Split text into runs so the UI can render line breaks and tabs visibly.
   * @returns {{t: "text"|"nl"|"tab", v: string}[]}
   */
  function tokenizeInvisibles(text) {
    const s = String(text == null ? "" : text);
    const out = [];
    let buf = "";
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === "\n" || c === "\t" || c === "\r") {
        if (buf) out.push({ t: "text", v: buf });
        buf = "";
        if (c === "\r") {
          if (s[i + 1] === "\n") i++;
          out.push({ t: "nl", v: "\n" });
        } else out.push({ t: c === "\n" ? "nl" : "tab", v: c });
      } else buf += c;
    }
    if (buf) out.push({ t: "text", v: buf });
    return out;
  }

  /* ---- Glossary ------------------------------------------------------------ */

  /** Does a glossary rule apply to this language pair? ("all" matches any language.) */
  function ruleMatchesPair(rule, sourceLang, targetLang) {
    const rs = String(rule.sourceLang || "all").toLowerCase();
    const rt = String(rule.targetLang || "all").toLowerCase();
    return (rs === "all" || rs === sourceLang) && (rt === "all" || rt === targetLang);
  }

  /** Build a case-insensitive matcher for a term where "*" stands for exactly one character. */
  function termRegExp(term) {
    const pattern = String(term)
      .split("*")
      .map(escapeRegExp)
      .join("[\\s\\S]");
    return new RegExp(pattern, "i");
  }

  /**
   * Glossary rules worth sending to the model: right language pair and the term occurs in the text.
   */
  function relevantRules(rules, sourceLang, targetLang, text) {
    const out = [];
    for (const rule of rules || []) {
      if (!rule || !rule.from || !rule.to) continue;
      if (!ruleMatchesPair(rule, sourceLang, targetLang)) continue;
      let hit = false;
      try {
        hit = termRegExp(rule.from).test(text);
      } catch (e) {
        hit = String(text).toLowerCase().includes(String(rule.from).toLowerCase());
      }
      if (hit) out.push(rule);
    }
    return out;
  }

  /* ---- Find & replace ------------------------------------------------------ */

  /**
   * Compile a finder for plain-text search.
   * @returns {{count: (s: string) => number, replace: (s: string, r: string) => string, split: (s: string) => string[]}}
   */
  function finder(needle, opts) {
    const o = opts || {};
    const flags = o.matchCase ? "g" : "gi";
    const re = new RegExp(escapeRegExp(needle), flags);
    return {
      count(s) {
        if (!needle) return 0;
        const m = String(s).match(re);
        return m ? m.length : 0;
      },
      replace(s, replacement) {
        if (!needle) return String(s);
        return String(s).replace(re, () => replacement);
      },
      /** Alternating [text, match, text, match, …] pieces for highlighting. */
      pieces(s) {
        const str = String(s);
        if (!needle) return [str];
        const out = [];
        let last = 0;
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(str))) {
          out.push(str.slice(last, m.index), m[0]);
          last = m.index + m[0].length;
          if (m[0].length === 0) re.lastIndex++;
        }
        out.push(str.slice(last));
        return out;
      },
    };
  }

  LS.text = {
    placeholders,
    comparePlaceholders,
    checkTranslation,
    tokenizeInvisibles,
    ruleMatchesPair,
    termRegExp,
    relevantRules,
    finder,
  };
})(globalThis.LS || (globalThis.LS = {}));
