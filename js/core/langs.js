/* Language Surface — language codes: normalization, names, search and detection heuristics. */
(function (LS) {
  "use strict";

  // code(s) : English name. Extra codes after "/" are legacy aliases.
  const TABLE = `
ab:Abkhazian|aa:Afar|af:Afrikaans|ak:Akan|sq:Albanian|am:Amharic|ar:Arabic|an:Aragonese|hy:Armenian|as:Assamese
av:Avaric|ae:Avestan|ay:Aymara|az:Azerbaijani|bm:Bambara|ba:Bashkir|eu:Basque|be:Belarusian|bn:Bengali|bh:Bihari
bi:Bislama|bs:Bosnian|br:Breton|bg:Bulgarian|my:Burmese|yue:Cantonese|ca:Catalan|ch:Chamorro|ce:Chechen|ny:Chichewa
zh:Chinese|zh-hans:Chinese (Simplified)|zh-hant:Chinese (Traditional)|zh-cn:Chinese (China)|zh-tw:Chinese (Taiwan)
zh-hk:Chinese (Hong Kong)|cv:Chuvash|kw:Cornish|co:Corsican|cr:Cree|hr:Croatian|cs:Czech|da:Danish|dv:Divehi|nl:Dutch
nl-be:Dutch (Belgium)|dz:Dzongkha|en:English|en-us:English (United States)|en-gb:English (United Kingdom)
en-au:English (Australia)|en-ca:English (Canada)|eo:Esperanto|et:Estonian|ee:Ewe|fo:Faroese|fj:Fijian|fil:Filipino
fi:Finnish|fr:French|fr-ca:French (Canada)|fr-ch:French (Switzerland)|ff:Fula|gl:Galician|gd:Scottish Gaelic
gv:Manx|ka:Georgian|de:German|de-at:German (Austria)|de-ch:German (Switzerland)|el:Greek|kl:Greenlandic|gn:Guarani
gu:Gujarati|ht:Haitian Creole|ha:Hausa|haw:Hawaiian|he/iw:Hebrew|hz:Herero|hi:Hindi|ho:Hiri Motu|hu:Hungarian
is:Icelandic|io:Ido|ig:Igbo|id/in:Indonesian|ia:Interlingua|ie:Interlingue|iu:Inuktitut|ik:Inupiaq|ga:Irish
it:Italian|ja:Japanese|jv:Javanese|kn:Kannada|kr:Kanuri|ks:Kashmiri|kk:Kazakh|km:Khmer|ki:Kikuyu|rw:Kinyarwanda
rn:Kirundi|ky:Kyrgyz|kv:Komi|kg:Kongo|ko:Korean|ku:Kurdish|ckb:Kurdish (Sorani)|kj:Kwanyama|lo:Lao|la:Latin
lv:Latvian|li:Limburgish|ln:Lingala|lt:Lithuanian|lu:Luba-Katanga|lg:Luganda|lb:Luxembourgish|mk:Macedonian
mg:Malagasy|ms:Malay|ml:Malayalam|mt:Maltese|mi:Maori|mr:Marathi|mh:Marshallese|mo:Moldavian|mn:Mongolian|na:Nauru
nv:Navajo|ng:Ndonga|nd:Northern Ndebele|ne:Nepali|no:Norwegian|nb:Norwegian Bokmål|nn:Norwegian Nynorsk|ii:Nuosu
oc:Occitan|oj:Ojibwe|cu:Old Church Slavonic|or:Odia|om:Oromo|os:Ossetian|pi:Pali|ps:Pashto|fa:Persian|pl:Polish
pt:Portuguese|pt-br:Portuguese (Brazil)|pt-pt:Portuguese (Portugal)|pa:Punjabi|qu:Quechua|rm:Romansh|ro:Romanian
ru:Russian|se:Northern Sami|sm:Samoan|sg:Sango|sa:Sanskrit|sr:Serbian|sr-latn:Serbian (Latin)|sr-cyrl:Serbian (Cyrillic)
sh:Serbo-Croatian|st:Sesotho|tn:Setswana|sn:Shona|sd:Sindhi|si:Sinhala|ss:Swati|sk:Slovak|sl:Slovenian|so:Somali
nr:Southern Ndebele|es:Spanish|es-es:Spanish (Spain)|es-mx:Spanish (Mexico)|es-419:Spanish (Latin America)
su:Sundanese|sw:Swahili|sv:Swedish|tl:Tagalog|ty:Tahitian|tg:Tajik|ta:Tamil|tt:Tatar|te:Telugu|th:Thai|bo:Tibetan
ti:Tigrinya|to:Tongan|ts:Tsonga|tr:Turkish|tk:Turkmen|tw:Twi|ug:Uyghur|uk:Ukrainian|ur:Urdu|uz:Uzbek|ve:Venda
vi:Vietnamese|vo:Volapük|wa:Walloon|cy:Welsh|wo:Wolof|fy:Western Frisian|xh:Xhosa|yi/ji:Yiddish|yo:Yoruba|za:Zhuang
zu:Zulu`;

  const LANGS = [];
  const BY_CODE = new Map();
  for (const item of TABLE.split(/[|\n]/)) {
    const entry = item.trim();
    if (!entry) continue;
    const idx = entry.indexOf(":");
    const codes = entry.slice(0, idx).split("/");
    const name = entry.slice(idx + 1);
    const lang = { code: codes[0], name, aliases: codes.slice(1) };
    LANGS.push(lang);
    for (const c of codes) BY_CODE.set(c, lang);
  }

  const KNOWN_BASES = new Set();
  for (const code of BY_CODE.keys()) KNOWN_BASES.add(code.split("-")[0]);

  const RTL_BASES = new Set(["ar", "he", "iw", "fa", "ur", "yi", "ji", "ps", "sd", "ug", "dv", "ckb", "syr", "nqo"]);

  // "en", "pt-br", "zh-hans" …
  const LANG_CODE_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;
  // "zh_CN", "pt_BR", "zh_Hans", "es_419" — canonical casing only, so snake_case keys ("is_ok") never match.
  const UNDERSCORE_LOCALE_RE = /^[a-z]{2,3}_(?:[A-Z]{2}|[A-Z][a-z]{3}|\d{3})$/;

  /** Canonical stored form: lowercase, hyphen-separated ("pt_BR" -> "pt-br"). */
  function normalize(code) {
    return String(code == null ? "" : code)
      .trim()
      .toLowerCase()
      .replace(/_/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 35);
  }

  /** BCP 47 casing for Intl APIs and exports: "pt-br" -> "pt-BR", "zh-hans" -> "zh-Hans". */
  function bcp47(code) {
    return normalize(code)
      .split("-")
      .map((part, i) => {
        if (i === 0) return part;
        if (part.length === 4 && /^[a-z]+$/.test(part)) return part[0].toUpperCase() + part.slice(1);
        if (part.length === 2 && /^[a-z]+$/.test(part)) return part.toUpperCase();
        return part;
      })
      .join("-");
  }

  /** Short UI label: "EN", "PT-BR". */
  function label(code) {
    return normalize(code).toUpperCase();
  }

  /** Format a code for file names / columns. style: "lower" | "bcp47" | "underscore". */
  function formatCode(code, style) {
    if (style === "bcp47") return bcp47(code);
    if (style === "underscore") return bcp47(code).replace(/-/g, "_");
    return normalize(code);
  }

  const nameCache = new Map();
  const nativeCache = new Map();
  let englishNames = null;

  function intlName(locale, tag) {
    try {
      let dn;
      if (locale === "en") {
        dn = englishNames || (englishNames = new Intl.DisplayNames(["en"], { type: "language", languageDisplay: "standard" }));
      } else {
        // Only trust the result when the runtime really has data for that locale.
        const supported = Intl.DisplayNames.supportedLocalesOf([locale]);
        if (!supported.length) return "";
        dn = new Intl.DisplayNames([locale], { type: "language", languageDisplay: "standard" });
      }
      const out = dn.of(tag);
      if (!out || out.toLowerCase() === tag.toLowerCase()) return "";
      return out;
    } catch (e) {
      return "";
    }
  }

  /** English display name, or "" when the code is unknown/custom. */
  function name(code) {
    const c = normalize(code);
    if (!c) return "";
    if (nameCache.has(c)) return nameCache.get(c);
    let out = "";
    const known = BY_CODE.get(c);
    if (known) out = known.name;
    if (!out && typeof Intl !== "undefined" && Intl.DisplayNames) out = intlName("en", bcp47(c));
    if (!out) {
      const base = BY_CODE.get(c.split("-")[0]);
      if (base && c.includes("-")) out = base.name + " (" + c.split("-").slice(1).join("-").toUpperCase() + ")";
    }
    nameCache.set(c, out);
    return out;
  }

  /** Name of the language in the language itself ("日本語"), or "" when unavailable or identical to name(). */
  function nativeName(code) {
    const c = normalize(code);
    if (!c) return "";
    if (nativeCache.has(c)) return nativeCache.get(c);
    let out = "";
    if (typeof Intl !== "undefined" && Intl.DisplayNames) {
      const tag = bcp47(c);
      out = intlName(tag, tag);
      if (out && out.toLowerCase() === name(c).toLowerCase()) out = "";
    }
    nativeCache.set(c, out);
    return out;
  }

  /** "Japanese" or, for unknown codes, the upper-cased code itself. */
  function displayName(code) {
    return name(code) || label(code);
  }

  function isRtl(code) {
    return RTL_BASES.has(normalize(code).split("-")[0]);
  }

  /** A value usable in an HTML lang="" attribute, or "" when the code is not a plausible language tag. */
  function htmlLang(code) {
    const c = normalize(code);
    if (!LANG_CODE_RE.test(c) || !KNOWN_BASES.has(c.split("-")[0])) return "";
    return bcp47(c);
  }

  function isKnown(code) {
    const c = normalize(code);
    return BY_CODE.has(c) || KNOWN_BASES.has(c.split("-")[0]);
  }

  /**
   * Rank languages for a picker.
   * @returns {{code: string, name: string}[]}
   */
  function search(query, opts) {
    const o = opts || {};
    const limit = o.limit || 8;
    const exclude = new Set((o.exclude || []).map(normalize));
    const q = String(query || "").trim().toLowerCase();
    const qCode = normalize(q);
    const scored = [];
    for (const lang of LANGS) {
      if (exclude.has(lang.code)) continue;
      const nm = lang.name.toLowerCase();
      const codes = [lang.code].concat(lang.aliases);
      let score = 999;
      if (!q) score = 100;
      else if (qCode && codes.some((c) => c === qCode)) score = 0;
      else if (qCode && codes.some((c) => c.startsWith(qCode))) score = 1;
      else if (nm.startsWith(q)) score = 2;
      else if (nm.split(/[\s(]+/).some((w) => w.startsWith(q))) score = 3;
      else if (nm.includes(q)) score = 4;
      else if (qCode && codes.some((c) => c.includes(qCode))) score = 5;
      if (score < 999) scored.push({ lang, score });
    }
    if (!q) {
      // Sensible defaults when nothing is typed yet.
      const common = ["en", "es", "fr", "de", "ja", "zh-hans", "ko", "pt-br", "it", "ru", "ar", "hi"];
      const picks = common.filter((c) => !exclude.has(c)).map((c) => BY_CODE.get(c));
      return picks.slice(0, limit).map((l) => ({ code: l.code, name: l.name }));
    }
    scored.sort((a, b) => a.score - b.score || a.lang.code.length - b.lang.code.length || a.lang.name.localeCompare(b.lang.name));
    return scored.slice(0, limit).map((s) => ({ code: s.lang.code, name: s.lang.name }));
  }

  /* ---- Detection heuristics (used by the importer) ---- */

  function looksLikeLangCode(s) {
    const str = String(s == null ? "" : s).trim();
    return LANG_CODE_RE.test(str) || UNDERSCORE_LOCALE_RE.test(str);
  }

  function looksLikeKnownLangBase(s) {
    const base = normalize(s).split("-")[0];
    return !!base && KNOWN_BASES.has(base);
  }

  /**
   * Do these object keys look like language codes (e.g. {en: "...", ja: "..."})?
   * All keys must be code-shaped and at least one must be a real language, which keeps
   * short namespaces like {hp, ok, top} from being mistaken for languages.
   */
  function looksLikeLangMapKeys(keys) {
    return (
      Array.isArray(keys) &&
      keys.length > 0 &&
      keys.every((k) => looksLikeLangCode(k)) &&
      keys.some((k) => looksLikeKnownLangBase(k))
    );
  }

  let regionNames = null;
  let scriptNames = null;
  function knownSubtag(kind, value) {
    try {
      if (kind === "region") {
        regionNames = regionNames || new Intl.DisplayNames(["en"], { type: "region" });
        const code = value.toUpperCase();
        const out = regionNames.of(code);
        return !!out && out !== code;
      }
      scriptNames = scriptNames || new Intl.DisplayNames(["en"], { type: "script" });
      const code = value[0].toUpperCase() + value.slice(1).toLowerCase();
      const out = scriptNames.of(code);
      return !!out && out !== code;
    } catch (e) {
      return kind === "region" ? /^([A-Za-z]{2}|\d{3})$/.test(value) : /^[A-Za-z]{4}$/.test(value);
    }
  }

  // Short file names that are far more likely to be a module name than a language.
  const NOT_A_LANGUAGE = new Set(["app", "web", "api", "ios", "dev", "all", "new", "old", "tmp", "src", "lib", "doc", "raw", "out", "res", "str", "msg", "ui", "db", "loc"]);

  /** Infer a language code from a file name: "en.json", "app_pt-BR.json", "strings.zh_CN.json". */
  function inferFromFileName(fileName) {
    const base = String(fileName || "").split(/[\\/]/).pop() || "";
    const noExt = base.replace(/\.[^.]+$/, "");
    if (!noExt) return "";
    // language-script-region at the end: zh-Hans-CN
    let m = noExt.match(/(?:^|[_.\-])([A-Za-z]{2,3})[_\-]([A-Za-z]{4})[_\-]([A-Za-z]{2}|\d{3})$/);
    if (m && looksLikeKnownLangBase(m[1]) && knownSubtag("script", m[2]) && knownSubtag("region", m[3])) {
      return normalize(m[1] + "-" + m[2] + "-" + m[3]);
    }
    // language-region or language-script at the end: project_pt-BR, messages_zh_CN, app.zh-Hans
    m = noExt.match(/(?:^|[_.\-])([A-Za-z]{2,3})[_\-]([A-Za-z]{4}|[A-Za-z]{2}|\d{3})$/);
    if (m && looksLikeKnownLangBase(m[1]) && knownSubtag(m[2].length === 4 ? "script" : "region", m[2])) {
      return normalize(m[1] + "-" + m[2]);
    }
    // simple trailing code: en, project_en, strings-ja, translation.en (custom codes like "zhs" included)
    m = noExt.match(/(?:^|[_.\-])([A-Za-z]{2,3})$/);
    if (m) {
      const code = normalize(m[1]);
      if (KNOWN_BASES.has(code) || !NOT_A_LANGUAGE.has(code)) return code;
    }
    return "";
  }

  LS.langs = {
    LANGS,
    normalize,
    bcp47,
    label,
    formatCode,
    name,
    nativeName,
    displayName,
    isRtl,
    htmlLang,
    isKnown,
    search,
    looksLikeLangCode,
    looksLikeKnownLangBase,
    looksLikeLangMapKeys,
    inferFromFileName,
  };
})(globalThis.LS || (globalThis.LS = {}));
