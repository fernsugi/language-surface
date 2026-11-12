/* Language Surface — small shared utilities (no DOM required unless noted). */
(function (LS) {
  "use strict";

  const natCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "variant" });
  const textCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

  /** Random id with a readable prefix, e.g. "p_k3f9x2a7_m1c4". */
  function uid(prefix) {
    const rand = Math.random().toString(36).slice(2, 10);
    return (prefix || "id") + "_" + rand + "_" + Date.now().toString(36);
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function debounce(fn, ms) {
    let t = null;
    function debounced(...args) {
      clearTimeout(t);
      t = setTimeout(() => {
        t = null;
        fn.apply(this, args);
      }, ms);
    }
    debounced.cancel = () => {
      clearTimeout(t);
      t = null;
    };
    debounced.flush = (...args) => {
      if (t === null) return;
      clearTimeout(t);
      t = null;
      fn(...args);
    };
    debounced.pending = () => t !== null;
    return debounced;
  }

  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(abortError());
      const t = setTimeout(done, ms);
      function done() {
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve();
      }
      function onAbort() {
        clearTimeout(t);
        reject(abortError());
      }
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  function abortError() {
    const e = new Error("Cancelled");
    e.name = "AbortError";
    return e;
  }

  function deepClone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /** Natural, case-aware comparison for keys ("item_2" sorts before "item_10"). */
  function natCompare(a, b) {
    return natCollator.compare(a, b);
  }

  /** Natural, case-insensitive comparison for human text. */
  function textCompare(a, b) {
    return textCollator.compare(a, b);
  }

  function uniq(arr) {
    return Array.from(new Set(arr));
  }

  function formatNumber(n) {
    return Number(n || 0).toLocaleString("en-US");
  }

  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) + " KB";
    if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0) + " MB";
    return (n / (1024 * 1024 * 1024)).toFixed(1) + " GB";
  }

  /** plural(2, "key") -> "2 keys"; plural(1, "entry", "entries") -> "1 entry". */
  function plural(n, one, many) {
    const word = n === 1 ? one : many || one + "s";
    return formatNumber(n) + " " + word;
  }

  function percent(part, total) {
    if (!total) return 0;
    return Math.round((part / total) * 100);
  }

  /** Completion percentage that never rounds an incomplete set up to 100 (or a started one down to 0). */
  function completion(part, total) {
    if (!total) return 100;
    if (part >= total) return 100;
    if (part <= 0) return 0;
    return clamp(Math.round((part / total) * 100), 1, 99);
  }

  function safeFileName(name) {
    return (
      String(name || "project")
        .trim()
        .replace(/[^\w\-]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "") || "project"
    );
  }

  function stripBom(text) {
    return text && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  function timeAgo(ts) {
    const diff = Date.now() - Number(ts || 0);
    if (!ts || diff < 0) return "";
    const s = Math.floor(diff / 1000);
    if (s < 45) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return m <= 1 ? "a minute ago" : m + " minutes ago";
    const h = Math.floor(m / 60);
    if (h < 24) return h === 1 ? "an hour ago" : h + " hours ago";
    const d = Math.floor(h / 24);
    if (d < 30) return d === 1 ? "yesterday" : d + " days ago";
    return new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  /** Count user-perceived characters (so emoji and combined glyphs count as one). */
  let segmenter = null;
  function charCount(str) {
    const s = String(str == null ? "" : str);
    if (!s) return 0;
    // Fast path: plain BMP text without combining marks or joiners.
    if (!/[̀-ͯ‍️\ud800-\udfff]/.test(s)) return s.length;
    try {
      if (!segmenter && typeof Intl !== "undefined" && Intl.Segmenter) {
        segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
      }
      if (segmenter) {
        let n = 0;
        for (const _ of segmenter.segment(s)) n++;
        return n;
      }
    } catch (e) {
      /* fall through */
    }
    return Array.from(s).length;
  }

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");

  LS.util = {
    uid,
    clamp,
    debounce,
    sleep,
    abortError,
    deepClone,
    escapeHtml,
    escapeRegExp,
    natCompare,
    textCompare,
    uniq,
    formatNumber,
    formatBytes,
    plural,
    percent,
    completion,
    safeFileName,
    stripBom,
    timeAgo,
    charCount,
    isMac,
  };
})(globalThis.LS || (globalThis.LS = {}));
