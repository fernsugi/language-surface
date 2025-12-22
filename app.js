/**
         * Language Surface — single-file app
         * - No external dependencies
         * - LocalStorage only
         * - Hash routing: #list, #edit/<key>, #settings
         */

const LS_KEY = "language_surface_v1";
const DEFAULT_STATE = () => ({
  version: 1,
  settings: {
    theme: "dark",
    cellDisplay: "clip", // clip | wrap
    openaiApiKey: "",
    openaiModel: "gpt-4.1-mini",
    defaultMaxChars: 0,
    defaultSourceLang: "en",
    confirmDeletes: true,
  },
  ui: {
    selectedProjectId: null,
    visibleLangs: [],
    seenWelcome: false,
    listFilterKey: "",
    listFilterText: "",
    listPageSize: 100,
    listPage: 0,
    listSortBy: "key", // "key" | "lang:<code>"
    listSortDir: "asc", // "asc" | "desc"
    colWidths: {},
  },
  projects: {}
});

function nowId() { return "p_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16); }

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return initState();
    const st = JSON.parse(raw);
    // basic merge (forward compatibility)
    const base = DEFAULT_STATE();
    const merged = {
      ...base,
      ...st,
      settings: { ...base.settings, ...(st.settings || {}) },
      ui: { ...base.ui, ...(st.ui || {}) },
      projects: st.projects || {}
    };
    if (!merged.ui.selectedProjectId || !merged.projects[merged.ui.selectedProjectId]) {
      const first = Object.keys(merged.projects)[0] || null;
      merged.ui.selectedProjectId = first;
    }
    return merged;
  } catch (e) {
    console.warn("Failed to load state", e);
    return initState();
  }
}

function saveState() {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

function initState() {
  const st = DEFAULT_STATE();
  const pid = nowId();
  st.projects[pid] = {
    id: pid,
    name: "Default Project",
    languages: ["en", "ja"],
    entries: {
      "lp.hello": { en: "Hello", ja: "こんにちは" },
      "lp.bye": { en: "Good Bye", ja: "さようなら" }
    },
    meta: { createdAt: Date.now(), updatedAt: Date.now() }
  };
  st.ui.selectedProjectId = pid;
  st.ui.visibleLangs = ["en"];
  localStorage.setItem(LS_KEY, JSON.stringify(st));
  return st;
}

let state = loadState();

function setTheme() {
  document.documentElement.setAttribute("data-theme", state.settings.theme || "dark");
  document.documentElement.setAttribute("data-cellmode", state.settings.cellDisplay || "clip");
}
setTheme();

/* ---------- Tiny UI helpers ---------- */
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

function toast(msg, sub = "") {
  const t = $("#toast");
  $("#toastMsg").textContent = msg;
  $("#toastSub").textContent = sub;
  t.style.display = "block";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.style.display = "none"; }, 2600);
}

function openModal({ title = "Confirm", desc = "", bodyHTML = "", okText = "OK", cancelText = "Cancel", danger = false }) {
  return new Promise((resolve) => {
    $("#modalTitle").textContent = title;
    $("#modalDesc").textContent = desc;
    $("#modalBody").innerHTML = bodyHTML || "";
    $("#modalOK").textContent = okText;
    $("#modalCancel").textContent = cancelText;
    $("#modalOK").className = "btn " + (danger ? "danger" : "primary");
    const back = $("#modalBack");
    back.style.display = "flex";

    const onCancel = () => { cleanup(); resolve(false); };
    const onOK = () => { cleanup(); resolve(true); };
    function cleanup() {
      back.style.display = "none";
      $("#modalCancel").removeEventListener("click", onCancel);
      $("#modalOK").removeEventListener("click", onOK);
      back.removeEventListener("click", onBg);
      document.removeEventListener("keydown", onEsc);
    }
    function onBg(e) { if (e.target === back) onCancel(); }
    function onEsc(e) { if (e.key === "Escape") onCancel(); }

    $("#modalCancel").addEventListener("click", onCancel);
    $("#modalOK").addEventListener("click", onOK);
    back.addEventListener("click", onBg);
    document.addEventListener("keydown", onEsc);
  });
}

function openChoiceModal({ title, desc, choices }) {
  // choices: [{label, value, hint?}]
  return new Promise((resolve) => {
    $("#modalTitle").textContent = title || "Choose";
    $("#modalDesc").textContent = desc || "";
    const body = $("#modalBody");
    body.innerHTML = (choices || []).map((c, idx) => {
      const hint = (c.hint || "").toString().trim();
      const main = hint
        ? `
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; width:100%;">
            <div style="text-align:left; flex:1; min-width:0;">
              <div>${escapeHtml(c.label)}</div>
              <div class="hint" style="margin-top:6px;">${escapeHtml(hint)}</div>
            </div>
            <div class="muted nowrap" style="padding-top:2px;">→</div>
          </div>
        `
        : `
          <span>${escapeHtml(c.label)}</span>
          <span class="muted nowrap">→</span>
        `;
      return `
        <div style="margin-bottom:10px;">
          <button class="btn" type="button" data-choice="${escapeAttr(String(c.value))}" id="mChoice_${idx}" style="width:100%; justify-content:space-between;">
            ${main}
          </button>
        </div>
      `;
    }).join("");

    const back = $("#modalBack");
    const footer = $("#modalCancel").closest(".mft");
    const prevFooterDisplay = footer.style.display;
    footer.style.display = "none";
    back.style.display = "flex";

    const onClick = (e) => {
      const btn = e.target && (e.target.closest ? e.target.closest("[data-choice]") : null);
      if (!btn) return;
      cleanup();
      resolve(btn.getAttribute("data-choice"));
    };
    const onBg = (e) => { if (e.target === back) { cleanup(); resolve(null); } };
    const onEsc = (e) => { if (e.key === "Escape") { cleanup(); resolve(null); } };

    function cleanup() {
      back.style.display = "none";
      footer.style.display = prevFooterDisplay;
      body.removeEventListener("click", onClick);
      back.removeEventListener("click", onBg);
      document.removeEventListener("keydown", onEsc);
    }

    body.addEventListener("click", onClick);
    back.addEventListener("click", onBg);
    document.addEventListener("keydown", onEsc);
  });
}

function currentProject() {
  return state.projects[state.ui.selectedProjectId] || null;
}
function setProject(id) {
  if (!state.projects[id]) return;
  state.ui.selectedProjectId = id;
  // default visible langs
  const p = currentProject();
  if (p) {
    const keep = (state.ui.visibleLangs || []).filter(l => p.languages.includes(l));
    state.ui.visibleLangs = keep.length ? keep : [p.languages[0]].filter(Boolean);
  }
  saveState();
  render();
}

function normalizeLangCode(s) {
  return (s || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
}
function normalizeKey(s) {
  return (s || "").trim().replace(/\s+/g, " ");
}

function bindCreateProjectControls() {
  const btn = $("#btnCreateProject");
  const inp = $("#inpNewProject");
  if (!btn || !inp) return;
  btn.addEventListener("click", () => {
    const name = (inp.value || "").trim() || "New Project";
    const pid = nowId();
    state.projects[pid] = {
      id: pid,
      name,
      languages: ["en"],
      entries: {},
      meta: { createdAt: Date.now(), updatedAt: Date.now() }
    };
    state.ui.selectedProjectId = pid;
    state.ui.visibleLangs = ["en"];
    saveState();
    inp.value = "";
    toast("Created project", name);
    render();
  });
}

function bindImportControls() {
  const btn = $("#btnImport");
  const inp = $("#fileImport");
  if (!btn || !inp) return;

  // import chooser
  btn.addEventListener("click", async () => {
    const mode = await openChoiceModal({
      title: "Import",
      desc: "Choose the format you are importing.",
      choices: [
        { label: "CSV (single file)", value: "csv" },
        { label: "Single JSON (nested translation map)", value: "single_json" },
        { label: "Multiple JSON (one file per language)", value: "multi_json", hint: "Tip: name files like en.json, ja.json, fr-ca.json" }
      ]
    });
    if (!mode) return;

    inp.dataset.importMode = mode;
    if (mode === "csv") {
      inp.multiple = false;
      inp.accept = ".csv,text/csv";
    } else if (mode === "single_json") {
      inp.multiple = false;
      inp.accept = ".json,application/json";
    } else {
      inp.multiple = true;
      inp.accept = ".json,application/json";
    }
    inp.click();
  });

  // import handler
  inp.addEventListener("change", async (e) => {
    const mode = e.target.dataset.importMode || "";
    const files = Array.from((e.target.files || [])).filter(Boolean);
    if (!files.length) return;

    const first = files[0];
    const nameNoExt = first.name.replace(/\.[^.]+$/, "");
    const ok = await openModal({
      title: "Import",
      desc: files.length > 1
        ? `Import ${files.length} files as a new project.`
        : `Import "${first.name}" as a new project.`,
      bodyHTML: `
        <label>Project name (optional)</label>
        <input id="mImportName" placeholder="${escapeAttr(nameNoExt)}" />
      `,
      okText: "Import"
    });
    if (!ok) { e.target.value = ""; return; }
    const projName = ($("#mImportName")?.value || "").trim() || nameNoExt;

    try {
      if (mode === "csv") {
        if (files.length !== 1) throw new Error("CSV import supports a single file.");
        const text = await first.text();
        importCSVToProject(text, projName);
      } else if (mode === "single_json") {
        if (files.length !== 1) throw new Error("Single JSON import supports a single file.");
        const text = await first.text();
        // Decide whether this JSON is a translation-map (multi-language) or a per-language nested JSON.
        let data;
        try { data = JSON.parse(text); }
        catch { throw new Error("Invalid JSON file."); }
        const isTranslationMap = !!jsonToEntriesAndLangs(data);
        if (isTranslationMap) {
          importJSONToProject(text, projName, first.name);
        } else {
          const inferred = inferLangFromFileName(first.name) || state.settings.defaultSourceLang || "en";
          const okLang = await openModal({
            title: "Single-language JSON",
            desc: "This file looks like a per-language nested JSON (values are strings). Choose which language to import it as.",
            bodyHTML: `
              <label>Language code</label>
              <input id="mImportLang" placeholder="e.g. en" value="${escapeAttr(inferred)}" />
              <div class="hint" style="margin-top:8px;">Tip: name the file like en.json / ja.json / fr-ca.json for auto-detect.</div>
            `,
            okText: "Import"
          });
          if (!okLang) throw new Error("Import cancelled.");
          const lang = normalizeLangCode($("#mImportLang")?.value || "");
          if (!lang) throw new Error("Language code is required.");
          importJSONToProject(text, projName, first.name, lang);
        }
      } else if (mode === "multi_json") {
        const bad = files.find(f => !f.name.toLowerCase().endsWith(".json"));
        if (bad) throw new Error("Multi-file import supports JSON files only.");
        await importJSONFilesToProject(files, projName);
      } else {
        throw new Error("Please choose an import type.");
      }

      const imported = currentProject();
      const langs = imported ? (imported.languages || []) : [];
      const keyCount = imported ? Object.keys(imported.entries || {}).length : 0;

      // Avoid confusion where a previous filter makes it look like only a few keys imported.
      state.ui.listFilterKey = "";
      state.ui.listFilterText = "";
      state.ui.listPage = 0;
      saveState();

      toast("Imported project", `${projName} • ${langs.join(", ") || "(no langs)"} • ${keyCount.toLocaleString()} keys`);
      render();
    } catch (err) {
      console.error(err);
      toast("Import failed", err.message || String(err));
    } finally {
      e.target.value = "";
      delete e.target.dataset.importMode;
    }
  });
}

/* ---------- Import/Export parsing ---------- */
function parseCSV(text) {
  // Simple CSV parser with quotes support
  const rows = [];
  let i = 0, field = "", row = [], inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      } else {
        field += c; i++; continue;
      }
    } else {
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ',') { row.push(field); field = ""; i++; continue; }
      if (c === '\n') {
        row.push(field); field = "";
        // ignore empty trailing line
        if (row.some(v => v !== "")) rows.push(row);
        row = []; i++; continue;
      }
      if (c === '\r') { i++; continue; }
      field += c; i++; continue;
    }
  }
  row.push(field);
  if (row.some(v => v !== "")) rows.push(row);
  if (rows.length < 2) throw new Error("CSV must have a header row and at least one data row.");
  return rows;
}

function importCSVToProject(csvText, projectName) {
  const rows = parseCSV(csvText);
  const header = rows[0].map(h => h.trim());
  if (header.length < 2) throw new Error("CSV header must include: key, <language...>");
  if (header[0].toLowerCase() !== "key") throw new Error('CSV first column must be named "key".');

  const langs = header.slice(1).map(normalizeLangCode).filter(Boolean);
  if (!langs.length) throw new Error("CSV must include at least one language column (e.g., en, ja).");

  const entries = {};
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const key = normalizeKey(row[0] || "");
    if (!key) continue;
    entries[key] = entries[key] || {};
    for (let c = 1; c < header.length; c++) {
      const lang = langs[c - 1];
      entries[key][lang] = (row[c] ?? "").toString();
    }
  }
  const pid = nowId();
  state.projects[pid] = {
    id: pid,
    name: projectName || "Imported CSV",
    languages: uniq(langs),
    entries,
    meta: { createdAt: Date.now(), updatedAt: Date.now() }
  };
  state.ui.selectedProjectId = pid;
  state.ui.visibleLangs = [state.projects[pid].languages[0]];
  saveState();
}

const LANG_CODE_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;

const LANG_TIPS = [
  { name: "Abkhazian", codes: ["ab"] },
  { name: "Afar", codes: ["aa"] },
  { name: "Afrikaans", codes: ["af"] },
  { name: "Akan", codes: ["ak"] },
  { name: "Albanian", codes: ["sq"] },
  { name: "Amharic", codes: ["am"] },
  { name: "Arabic", codes: ["ar"] },
  { name: "Aragonese", codes: ["an"] },
  { name: "Armenian", codes: ["hy"] },
  { name: "Assamese", codes: ["as"] },
  { name: "Avaric", codes: ["av"] },
  { name: "Avestan", codes: ["ae"] },
  { name: "Aymara", codes: ["ay"] },
  { name: "Azerbaijani", codes: ["az"] },
  { name: "Bambara", codes: ["bm"] },
  { name: "Bashkir", codes: ["ba"] },
  { name: "Basque", codes: ["eu"] },
  { name: "Belarusian", codes: ["be"] },
  { name: "Bengali (Bangla)", codes: ["bn"] },
  { name: "Bihari", codes: ["bh"] },
  { name: "Bislama", codes: ["bi"] },
  { name: "Bosnian", codes: ["bs"] },
  { name: "Breton", codes: ["br"] },
  { name: "Bulgarian", codes: ["bg"] },
  { name: "Burmese", codes: ["my"] },
  { name: "Catalan", codes: ["ca"] },
  { name: "Chamorro", codes: ["ch"] },
  { name: "Chechen", codes: ["ce"] },
  { name: "Chichewa, Chewa, Nyanja", codes: ["ny"] },
  { name: "Chinese", codes: ["zh"] },
  { name: "Chinese (Simplified)", codes: ["zh-hans"] },
  { name: "Chinese (Traditional)", codes: ["zh-hant"] },
  { name: "Chuvash", codes: ["cv"] },
  { name: "Cornish", codes: ["kw"] },
  { name: "Corsican", codes: ["co"] },
  { name: "Cree", codes: ["cr"] },
  { name: "Croatian", codes: ["hr"] },
  { name: "Czech", codes: ["cs"] },
  { name: "Danish", codes: ["da"] },
  { name: "Divehi, Dhivehi, Maldivian", codes: ["dv"] },
  { name: "Dutch", codes: ["nl"] },
  { name: "Dzongkha", codes: ["dz"] },
  { name: "English", codes: ["en"] },
  { name: "Esperanto", codes: ["eo"] },
  { name: "Estonian", codes: ["et"] },
  { name: "Ewe", codes: ["ee"] },
  { name: "Faroese", codes: ["fo"] },
  { name: "Fijian", codes: ["fj"] },
  { name: "Finnish", codes: ["fi"] },
  { name: "French", codes: ["fr"] },
  { name: "Fula, Fulah, Pulaar, Pular", codes: ["ff"] },
  { name: "Galician", codes: ["gl"] },
  { name: "Gaelic (Scottish)", codes: ["gd"] },
  { name: "Gaelic (Manx)", codes: ["gv"] },
  { name: "Georgian", codes: ["ka"] },
  { name: "German", codes: ["de"] },
  { name: "Greek", codes: ["el"] },
  { name: "Greenlandic", codes: ["kl"] },
  { name: "Guarani", codes: ["gn"] },
  { name: "Gujarati", codes: ["gu"] },
  { name: "Haitian Creole", codes: ["ht"] },
  { name: "Hausa", codes: ["ha"] },
  { name: "Hebrew", codes: ["he"] },
  { name: "Herero", codes: ["hz"] },
  { name: "Hindi", codes: ["hi"] },
  { name: "Hiri Motu", codes: ["ho"] },
  { name: "Hungarian", codes: ["hu"] },
  { name: "Icelandic", codes: ["is"] },
  { name: "Ido", codes: ["io"] },
  { name: "Igbo", codes: ["ig"] },
  { name: "Indonesian", codes: ["id", "in"] },
  { name: "Interlingua", codes: ["ia"] },
  { name: "Interlingue", codes: ["ie"] },
  { name: "Inuktitut", codes: ["iu"] },
  { name: "Inupiak", codes: ["ik"] },
  { name: "Irish", codes: ["ga"] },
  { name: "Italian", codes: ["it"] },
  { name: "Japanese", codes: ["ja"] },
  { name: "Javanese", codes: ["jv"] },
  { name: "Kannada", codes: ["kn"] },
  { name: "Kanuri", codes: ["kr"] },
  { name: "Kashmiri", codes: ["ks"] },
  { name: "Kazakh", codes: ["kk"] },
  { name: "Khmer", codes: ["km"] },
  { name: "Kikuyu", codes: ["ki"] },
  { name: "Kinyarwanda (Rwanda)", codes: ["rw"] },
  { name: "Kirundi", codes: ["rn"] },
  { name: "Kyrgyz", codes: ["ky"] },
  { name: "Komi", codes: ["kv"] },
  { name: "Kongo", codes: ["kg"] },
  { name: "Korean", codes: ["ko"] },
  { name: "Kurdish", codes: ["ku"] },
  { name: "Kwanyama", codes: ["kj"] },
  { name: "Lao", codes: ["lo"] },
  { name: "Latin", codes: ["la"] },
  { name: "Latvian (Lettish)", codes: ["lv"] },
  { name: "Limburgish (Limburger)", codes: ["li"] },
  { name: "Lingala", codes: ["ln"] },
  { name: "Lithuanian", codes: ["lt"] },
  { name: "Luga-Katanga", codes: ["lu"] },
  { name: "Luganda, Ganda", codes: ["lg"] },
  { name: "Luxembourgish", codes: ["lb"] },
  { name: "Macedonian", codes: ["mk"] },
  { name: "Malagasy", codes: ["mg"] },
  { name: "Malay", codes: ["ms"] },
  { name: "Malayalam", codes: ["ml"] },
  { name: "Maltese", codes: ["mt"] },
  { name: "Maori", codes: ["mi"] },
  { name: "Marathi", codes: ["mr"] },
  { name: "Marshallese", codes: ["mh"] },
  { name: "Moldavian", codes: ["mo"] },
  { name: "Mongolian", codes: ["mn"] },
  { name: "Nauru", codes: ["na"] },
  { name: "Navajo", codes: ["nv"] },
  { name: "Ndonga", codes: ["ng"] },
  { name: "Northern Ndebele", codes: ["nd"] },
  { name: "Nepali", codes: ["ne"] },
  { name: "Norwegian", codes: ["no"] },
  { name: "Norwegian bokmål", codes: ["nb"] },
  { name: "Norwegian nynorsk", codes: ["nn"] },
  { name: "Nuosu", codes: ["ii"] },
  { name: "Occitan", codes: ["oc"] },
  { name: "Ojibwe", codes: ["oj"] },
  { name: "Old Church Slavonic, Old Bulgarian", codes: ["cu"] },
  { name: "Oriya", codes: ["or"] },
  { name: "Oromo (Afaan Oromo)", codes: ["om"] },
  { name: "Ossetian", codes: ["os"] },
  { name: "Pāli", codes: ["pi"] },
  { name: "Pashto, Pushto", codes: ["ps"] },
  { name: "Persian (Farsi)", codes: ["fa"] },
  { name: "Polish", codes: ["pl"] },
  { name: "Portuguese", codes: ["pt"] },
  { name: "Punjabi (Eastern)", codes: ["pa"] },
  { name: "Quechua", codes: ["qu"] },
  { name: "Romansh", codes: ["rm"] },
  { name: "Romanian", codes: ["ro"] },
  { name: "Russian", codes: ["ru"] },
  { name: "Sami", codes: ["se"] },
  { name: "Samoan", codes: ["sm"] },
  { name: "Sango", codes: ["sg"] },
  { name: "Sanskrit", codes: ["sa"] },
  { name: "Serbian", codes: ["sr"] },
  { name: "Serbo-Croatian", codes: ["sh"] },
  { name: "Sesotho", codes: ["st"] },
  { name: "Setswana", codes: ["tn"] },
  { name: "Shona", codes: ["sn"] },
  { name: "Sindhi", codes: ["sd"] },
  { name: "Sinhalese", codes: ["si"] },
  { name: "Siswati", codes: ["ss"] },
  { name: "Slovak", codes: ["sk"] },
  { name: "Slovenian", codes: ["sl"] },
  { name: "Somali", codes: ["so"] },
  { name: "Southern Ndebele", codes: ["nr"] },
  { name: "Spanish", codes: ["es"] },
  { name: "Sundanese", codes: ["su"] },
  { name: "Swahili (Kiswahili)", codes: ["sw"] },
  { name: "Swedish", codes: ["sv"] },
  { name: "Tagalog", codes: ["tl"] },
  { name: "Tahitian", codes: ["ty"] },
  { name: "Tajik", codes: ["tg"] },
  { name: "Tamil", codes: ["ta"] },
  { name: "Tatar", codes: ["tt"] },
  { name: "Telugu", codes: ["te"] },
  { name: "Thai", codes: ["th"] },
  { name: "Tibetan", codes: ["bo"] },
  { name: "Tigrinya", codes: ["ti"] },
  { name: "Tonga", codes: ["to"] },
  { name: "Tsonga", codes: ["ts"] },
  { name: "Turkish", codes: ["tr"] },
  { name: "Turkmen", codes: ["tk"] },
  { name: "Twi", codes: ["tw"] },
  { name: "Uyghur", codes: ["ug"] },
  { name: "Ukrainian", codes: ["uk"] },
  { name: "Urdu", codes: ["ur"] },
  { name: "Uzbek", codes: ["uz"] },
  { name: "Venda", codes: ["ve"] },
  { name: "Vietnamese", codes: ["vi"] },
  { name: "Volapük", codes: ["vo"] },
  { name: "Wallon", codes: ["wa"] },
  { name: "Welsh", codes: ["cy"] },
  { name: "Wolof", codes: ["wo"] },
  { name: "Western Frisian", codes: ["fy"] },
  { name: "Xhosa", codes: ["xh"] },
  { name: "Yiddish", codes: ["yi", "ji"] },
  { name: "Yoruba", codes: ["yo"] },
  { name: "Zhuang, Chuang", codes: ["za"] },
  { name: "Zulu", codes: ["zu"] },
];

const KNOWN_LANG_BASES = new Set(
  LANG_TIPS
    .flatMap(it => (it.codes || []))
    .map(c => normalizeLangCode(c).split("-")[0])
    .filter(Boolean)
);

function langTipMatches(query, limit = 2) {
  const q = (query || "").trim().toLowerCase();
  const score = (item) => {
    const name = item.name.toLowerCase();
    const codes = item.codes.map(c => c.toLowerCase());
    if (!q) return 999;
    if (codes.some(c => c === q)) return 0;
    if (codes.some(c => c.startsWith(q))) return 1;
    if (name.startsWith(q)) return 2;
    if (name.includes(q)) return 3;
    if (codes.some(c => c.includes(q))) return 4;
    return 999;
  };
  return LANG_TIPS
    .map(it => ({ it, s: score(it) }))
    .filter(x => x.s < 999)
    .sort((a, b) => a.s - b.s || a.it.name.localeCompare(b.it.name))
    .slice(0, limit)
    .map(x => x.it);
}

function renderLangTipsHTML(query) {
  const hits = langTipMatches(query, 2);
  const fallback = [
    { name: "English", codes: ["en"] },
    { name: "Japanese", codes: ["ja"] },
    { name: "French", codes: ["fr"] },
    { name: "German", codes: ["de"] },
  ];
  const items = (hits.length ? hits : fallback).slice(0, 2);
  const parts = items.map(it => {
    const code = (it.codes[0] || "").toLowerCase();
    return `<span class="langTipMiniItem"><code>${escapeHtml(code)}</code><span class="langTipMiniSep">=</span>${escapeHtml(it.name)}</span>`;
  }).join(`<span class="langTipMiniDot"> • </span>`);
  return `<div class="langTipMini">${parts}</div>`;
}

function isPrimitive(v) {
  return v === null || v === undefined || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function looksLikeLangCode(s) {
  return LANG_CODE_RE.test((s || "").trim());
}

function looksLikeKnownLangBase(s) {
  const base = normalizeLangCode((s || "").trim()).split("-")[0];
  return !!base && KNOWN_LANG_BASES.has(base);
}

function looksLikeLangMapKeys(keys) {
  // Prevent false positives in nested i18n files where many short keys exist (e.g. "hp", "ok", "top").
  // Heuristic: language maps must look like language codes AND have known bases.
  return Array.isArray(keys) &&
    keys.length > 0 &&
    keys.every(k => looksLikeLangCode(k)) &&
    keys.every(k => looksLikeKnownLangBase(k));
}

function tryParseJSON(text, fileLabel = "") {
  // Tries strict JSON first, then a lightweight JSONC-style fallback.
  // This helps with translation files that include comments or trailing commas.
  try {
    return JSON.parse(text);
  } catch {
    // Strip /* */ and // comments (best-effort), then trailing commas.
    const noComments = String(text)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    const noTrailingCommas = noComments
      .replace(/,\s*(\}|\])/g, "$1");
    try {
      return JSON.parse(noTrailingCommas);
    } catch {
      throw new Error(fileLabel ? `Invalid JSON: ${fileLabel}` : "Invalid JSON file.");
    }
  }
}

function shouldSkipImportedKey(key) {
  // Skip only root metadata keys from common i18n formats.
  // Keep nested keys like "common.label" if they ever exist.
  if (!key) return true;
  if (key.includes(".")) return false;
  return key === "label" || key === "alias";
}

function flattenNestedLangMaps(obj, prefix = "") {
  // Converts nested objects like {lp:{hello:{en:"Hello"}}} into {"lp.hello":{en:"Hello"}}
  // Only treats leaves as lang maps when keys look like language codes.
  const out = {};
  function walk(node, path) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    const keys = Object.keys(node);
    const isLangMap =
      !!path &&
      keys.length > 0 &&
      looksLikeLangMapKeys(keys) &&
      keys.every(k => isPrimitive(node[k]));
    if (isLangMap) {
      out[path] = node;
      return;
    }
    for (const k of keys) {
      const next = path ? (path + "." + k) : k;
      walk(node[k], next);
    }
  }
  walk(obj, prefix);
  return out;
}

function flattenNestedValues(obj, prefix = "") {
  // Flattens nested JSON into dotted keys with primitive leaf values.
  // Example: {common:{cancel:"Cancel"}} -> {"common.cancel":"Cancel"}
  const out = {};
  function walk(node, path) {
    if (isPrimitive(node)) {
      if (path) out[path] = node;
      return;
    }
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      // Preserve array positions to avoid collisions.
      for (let i = 0; i < node.length; i++) {
        const next = path ? `${path}[${i}]` : `[${i}]`;
        walk(node[i], next);
      }
      return;
    }
    for (const k of Object.keys(node)) {
      const next = path ? (path + "." + k) : k;
      walk(node[k], next);
    }
  }
  walk(obj, prefix);
  return out;
}

function flattenNestedValuesForLang(obj, lang, prefix = "") {
  // Like flattenNestedValues, but if a nested object looks like a language-map
  // (e.g. {en:"Battle", ja:"戦目"}), treat it as a leaf and pick the best value
  // for the requested language.
  const out = {};
  const wanted = normalizeLangCode(lang);
  const fallbackLang = normalizeLangCode(state?.settings?.defaultSourceLang || "en") || "en";

  function pickFromLangMap(node) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return undefined;
    const keys = Object.keys(node);
    if (!looksLikeLangMapKeys(keys)) return undefined;
    if (!keys.every(k => isPrimitive(node[k]))) return undefined;

    const direct = wanted && Object.prototype.hasOwnProperty.call(node, wanted) ? node[wanted] : undefined;
    if (isPrimitive(direct)) return direct;

    const fallback = fallbackLang && Object.prototype.hasOwnProperty.call(node, fallbackLang) ? node[fallbackLang] : undefined;
    if (isPrimitive(fallback)) return fallback;

    const firstKey = keys[0];
    const firstVal = node[firstKey];
    return isPrimitive(firstVal) ? firstVal : undefined;
  }

  function walk(node, path) {
    if (isPrimitive(node)) {
      if (path) out[path] = node;
      return;
    }
    if (!node || typeof node !== "object") return;

    const picked = pickFromLangMap(node);
    if (picked !== undefined) {
      if (path) out[path] = picked;
      return;
    }

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const next = path ? `${path}[${i}]` : `[${i}]`;
        walk(node[i], next);
      }
      return;
    }

    for (const k of Object.keys(node)) {
      const next = path ? (path + "." + k) : k;
      walk(node[k], next);
    }
  }

  walk(obj, prefix);
  return out;
}

function inferLangFromFileName(fileName) {
  const base = (fileName || "").split("/").pop() || "";
  const noExt = base.replace(/\.[^.]+$/, "");
  // Accept either "en.json" or "project_en.json" / "project-en.json"
  // We intentionally take the trailing segment to reduce false positives.
  const m = noExt.match(/(?:^|[_-])([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)$/);
  const candidate = normalizeLangCode(m ? m[1] : noExt);
  return looksLikeLangCode(candidate) ? candidate : "";
}

function jsonToEntriesAndLangs(data) {
  // Accept either:
  // 1) {"lp.hello": {"en":"Hello","ja":"こんにちは"}}
  // 2) nested: { lp: { hello: { en:"Hello", ja:"..." } } }
  // Returns null if it doesn't look like a translation-map JSON.
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;

  const keys = Object.keys(data);
  const looksFlat = keys.some(k => k.includes("."));
  let flat = {};

  if (looksFlat) {
    // Validate flat entries that actually look like {key:{lang:value}}
    for (const k of keys) {
      const map = data[k];
      if (!map || typeof map !== "object" || Array.isArray(map)) continue;
      const mk = Object.keys(map);
      if (!mk.length) continue;
      if (!looksLikeLangMapKeys(mk)) continue;
      if (!mk.every(langKey => isPrimitive(map[langKey]))) continue;
      flat[k] = map;
    }
  } else {
    flat = flattenNestedLangMaps(data);
  }

  const entries = {};
  const langsSet = new Set();
  for (const k of Object.keys(flat)) {
    const key = normalizeKey(k);
    if (!key) continue;
    const map = flat[k];
    if (!map || typeof map !== "object" || Array.isArray(map)) continue;
    entries[key] = entries[key] || {};
    for (const langRaw of Object.keys(map)) {
      const lang = normalizeLangCode(langRaw);
      if (!lang || !looksLikeLangCode(lang)) continue;
      const v = map[langRaw];
      if (isPrimitive(v)) {
        entries[key][lang] = (v ?? "").toString();
        langsSet.add(lang);
      }
    }
    if (Object.keys(entries[key]).length === 0) delete entries[key];
  }

  const langs = uniq(Array.from(langsSet));
  if (!Object.keys(entries).length || !langs.length) return null;
  return { entries, langs };
}

function mergeEntries(into, from) {
  for (const k of Object.keys(from || {})) {
    into[k] = into[k] || {};
    const src = from[k] || {};
    for (const lang of Object.keys(src)) {
      into[k][lang] = (src[lang] ?? "").toString();
    }
  }
}

function importJSONToProject(jsonText, projectName, fileName = "", forcedLang = "") {
  const data = tryParseJSON(jsonText, fileName || "");
  if (!data || typeof data !== "object") throw new Error("JSON root must be an object.");

  // First try translation-map JSON (single-file export style)
  const parsed = jsonToEntriesAndLangs(data);

  let entries = {};
  let langs = [];
  if (parsed) {
    entries = parsed.entries;
    langs = parsed.langs;
  } else {
    // Fallback: treat as single-language i18n file (multi-file export style)
    const lang = normalizeLangCode(forcedLang) || inferLangFromFileName(fileName) || state.settings.defaultSourceLang || "en";
    const flatVals = flattenNestedValuesForLang(data, lang);
    for (const k of Object.keys(flatVals)) {
      const key = normalizeKey(k);
      if (!key) continue;
      if (shouldSkipImportedKey(key)) continue;
      entries[key] = entries[key] || {};
      entries[key][lang] = (flatVals[k] ?? "").toString();
    }
    if (!Object.keys(entries).length) throw new Error("JSON didn't contain any importable string values.");
    langs = [lang];
  }

  const pid = nowId();
  state.projects[pid] = {
    id: pid,
    name: projectName || "Imported JSON",
    languages: langs,
    entries,
    meta: { createdAt: Date.now(), updatedAt: Date.now() }
  };
  state.ui.selectedProjectId = pid;
  state.ui.visibleLangs = [langs[0]];
  saveState();
}

async function importJSONFilesToProject(files, projectName) {
  const combinedEntries = {};
  const langsSet = new Set();

  function unwrapSingleLangRoot(obj, inferredLang = "") {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { obj, lang: "" };
    const ks = Object.keys(obj);
    if (ks.length !== 1) return { obj, lang: "" };
    const k = ks[0];
    if (!looksLikeLangCode(k)) return { obj, lang: "" };
    // Only unwrap if the wrapper key matches the filename language (to avoid accidental unwrapping like {"top": {...}}).
    if (inferredLang && normalizeLangCode(k) !== normalizeLangCode(inferredLang)) return { obj, lang: "" };
    const inner = obj[k];
    if (!inner || typeof inner !== "object" || Array.isArray(inner)) return { obj, lang: "" };
    return { obj: inner, lang: normalizeLangCode(k) };
  }

  for (const file of files) {
    const text = await file.text();
    const data = tryParseJSON(text, file.name);
    if (!data || typeof data !== "object") throw new Error(`JSON root must be an object: ${file.name}`);

    const inferredFromName = inferLangFromFileName(file.name);
    const unwrapped = unwrapSingleLangRoot(data, inferredFromName);
    const lang = unwrapped.lang || inferredFromName;

    if (!lang) {
      // If user didn't name files with language codes, allow a translation-map JSON as a fallback.
      const parsed = jsonToEntriesAndLangs(data);
      if (parsed) {
        mergeEntries(combinedEntries, parsed.entries);
        for (const l of parsed.langs) langsSet.add(l);
        continue;
      }
      throw new Error(`Cannot infer language from filename: ${file.name}. Name files like "en.json", "ja.json", "fr-ca.json".`);
    }

    const flatVals = flattenNestedValuesForLang(unwrapped.obj, lang);
    const singleEntries = {};
    for (const k of Object.keys(flatVals)) {
      const key = normalizeKey(k);
      if (!key) continue;
      if (shouldSkipImportedKey(key)) continue;
      singleEntries[key] = singleEntries[key] || {};
      singleEntries[key][lang] = (flatVals[k] ?? "").toString();
    }
    if (!Object.keys(singleEntries).length) {
      throw new Error(`No importable string values found in: ${file.name}`);
    }
    mergeEntries(combinedEntries, singleEntries);
    langsSet.add(lang);
  }

  if (!Object.keys(combinedEntries).length) throw new Error("JSON didn't contain any importable entries.");
  const langs = uniq(Array.from(langsSet));
  if (!langs.length) throw new Error("JSON didn't contain any language codes.");

  const pid = nowId();
  state.projects[pid] = {
    id: pid,
    name: projectName || "Imported JSON",
    languages: langs,
    entries: combinedEntries,
    meta: { createdAt: Date.now(), updatedAt: Date.now() }
  };
  state.ui.selectedProjectId = pid;
  state.ui.visibleLangs = [langs[0]];
  saveState();
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function toNestedObjectFromDotted(entriesForLangOrMap) {
  // entriesForLangOrMap: { "lp.hello": "Hello", "lp.bye":"..." } OR { "lp.hello": {en:"",ja:""} }
  const root = {};
  for (const key of Object.keys(entriesForLangOrMap)) {
    const parts = key.split(".").filter(Boolean);
    if (!parts.length) continue;
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const last = i === parts.length - 1;
      if (last) {
        cur[p] = entriesForLangOrMap[key];
      } else {
        cur[p] = cur[p] && typeof cur[p] === "object" ? cur[p] : {};
        cur = cur[p];
      }
    }
  }
  return root;
}

function downloadFile(filename, content, mime = "application/octet-stream") {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 0);
}

/* ---------- OpenAI translate (Responses API) ---------- */
async function openAITranslate({ sourceText, sourceLang, targetLang, maxChars = 0, extraContext = "" }) {
  const key = (state.settings.openaiApiKey || "").trim();
  if (!key) throw new Error("Missing API key. Add it in Settings.");
  const model = (state.settings.openaiModel || "gpt-4.1-mini").trim();

  const limitLine = maxChars && Number(maxChars) > 0
    ? `- Output must be <= ${Number(maxChars)} characters.\n`
    : "";

  const prompt =
    `You are a professional localization translator.
Translate the text from ${sourceLang} to ${targetLang}.
Rules:
- Keep placeholders intact (e.g. {name}, %s, %d, {{var}}, ${'${var}'}).
- Keep punctuation style natural for the target language.
${limitLine}${extraContext ? "- Extra context: " + extraContext + "\n" : ""}
Return ONLY the translated text, no quotes, no explanations.

Text:
${sourceText}`;

  // Responses API (recommended for new projects)
  // Docs: https://platform.openai.com/docs/api-reference/responses
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + key
    },
    body: JSON.stringify({
      model,
      input: prompt,
      // Try to nudge short, clean output
      temperature: 0.2
    })
  });

  if (!res.ok) {
    let errText = await res.text().catch(() => "");
    throw new Error(`OpenAI error (${res.status}): ${errText || res.statusText}`);
  }
  const data = await res.json();

  // Extract text from Responses API output
  // We handle common shapes robustly
  let outText = "";
  if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item && item.type === "message" && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c && c.type === "output_text" && typeof c.text === "string") {
            outText += c.text;
          }
        }
      }
      if (item && item.type === "output_text" && typeof item.text === "string") {
        outText += item.text;
      }
    }
  }
  outText = (outText || "").trim();
  if (!outText) throw new Error("AI returned empty output.");
  return outText;
}

/* ---------- Routing ---------- */
function route() {
  const h = location.hash.replace(/^#/, "") || "list";
  const [path, arg] = h.split("/", 2);
  return { path, arg: decodeURIComponent(arg || "") };
}

/* ---------- Render ---------- */
$("#btnList").addEventListener("click", () => { location.hash = "#list"; });
$("#btnSettings").addEventListener("click", () => { location.hash = "#settings"; });

window.addEventListener("hashchange", render);

function render() {
  setTheme();
  const p = currentProject();
  $("#pillProject").textContent = "Project: " + (p ? p.name : "—");

  document.body.dataset.welcome = "false";

  const { path, arg } = route();
  if ((path === "welcome") || (path === "list" && !state.ui.seenWelcome)) return renderWelcome();
  if (path === "settings") return renderSettings();
  if (path === "edit") return renderEdit(arg);
  return renderList();
}

function renderWelcome() {
  document.body.dataset.welcome = "true";
  $("#view").innerHTML = `
    <div class="welcomeScreen">
      <div class="welcomeCenter">
        <div class="welcomeTitle">language-surface</div>
        <button class="btn primary welcomeStartBtn" id="btnWelcomeStart" type="button">Start</button>
      </div>
    </div>
  `;

  $("#btnWelcomeStart").addEventListener("click", () => {
    state.ui.seenWelcome = true;
    saveState();
    // If we're already on #list (but showing Welcome), hashchange won't fire.
    if (location.hash === "#list") {
      render();
      return;
    }
    location.hash = "#list";
  });
}

/* ---------- List View ---------- */
function renderList() {
  const p = currentProject();
  if (!p) {
    $("#view").innerHTML = `
      <div class="card">
        <div class="hd">
          <div><h2>No project found</h2></div>
        </div>
        <div class="bd">
          <div class="hint">Create a new project or import files to get started.</div>

          <div class="row" style="margin-top:12px;">
            <div style="flex:1">
              <label>Create new project</label>
              <input id="inpNewProject" placeholder="Project name" />
            </div>
            <button class="btn primary" id="btnCreateProject" type="button">Create</button>
          </div>

          <div class="row" style="margin-top:12px;">
            <div style="flex:1">
              <label>Import</label>
              <div class="hint">Import creates a new project from your files.</div>
            </div>
            <button class="btn blue" id="btnImport" type="button">Import…</button>
            <input type="file" id="fileImport" style="display:none" />
          </div>
        </div>
      </div>
    `;

    bindCreateProjectControls();
    bindImportControls();
    return;
  }

  state.ui.colWidths = (state.ui.colWidths && typeof state.ui.colWidths === "object") ? state.ui.colWidths : {};

  // Ensure visible langs valid
  state.ui.visibleLangs = (state.ui.visibleLangs || []).filter(l => p.languages.includes(l));
  if (!state.ui.visibleLangs.length) state.ui.visibleLangs = [p.languages[0]].filter(Boolean);
  saveState();

  const entries = p.entries || {};
  const keysAll = Object.keys(entries).sort((a, b) => a.localeCompare(b));
  const visibleLangs = state.ui.visibleLangs;
  const primaryLang = visibleLangs[0] || p.languages[0] || "";
  const cellMode = state.settings.cellDisplay || "clip";

  const sortBy = (state.ui.listSortBy || "key").toString();
  const sortDir = state.ui.listSortDir === "desc" ? "desc" : "asc";

  const sortOptions = [
    { value: "key", label: "Key" },
    ...visibleLangs.map(l => ({ value: "lang:" + l, label: l.toUpperCase() }))
  ];

  const PAGE_SIZES = [25, 50, 100, 200, 500, 1000];
  const normalizePageSize = (n) => (PAGE_SIZES.includes(n) ? n : 100);
  state.ui.listPageSize = normalizePageSize(Number(state.ui.listPageSize || 100));
  state.ui.listPage = Math.max(0, Number(state.ui.listPage || 0) | 0);
  const getPageSize = () => normalizePageSize(Number(state.ui.listPageSize || 100));
  const pageSizeForUI = getPageSize();

  const projectOptions = Object.values(state.projects)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(pr => `<option value="${escapeHtml(pr.id)}" ${pr.id === p.id ? "selected" : ""}>${escapeHtml(pr.name)}</option>`)
    .join("");

  const langChips = p.languages.map(l => {
    const on = visibleLangs.includes(l);
    return `<span class="chip ${on ? "on" : ""}" data-langchip="${escapeHtml(l)}">${escapeHtml(l.toUpperCase())}</span>`;
  }).join("");

  function getFilteredKeys() {
    const keyFilter = (state.ui.listFilterKey || "").toLowerCase();
    const textFilter = (state.ui.listFilterText || "").toLowerCase();

    const filtered = keysAll.filter((k) => {
      if (keyFilter && !k.toLowerCase().includes(keyFilter)) return false;
      if (!textFilter) return true;
      const row = entries[k] || {};
      for (const lang of (visibleLangs.length ? visibleLangs : p.languages)) {
        const v = row && lang ? (row[lang] ?? "") : "";
        if ((v ?? "").toString().toLowerCase().includes(textFilter)) return true;
      }
      return false;
    });

    const dirMul = sortDir === "desc" ? -1 : 1;

    const cmpKey = (a, b) => a.localeCompare(b);
    const cmpText = (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" });

    if (sortBy === "key") {
      filtered.sort((a, b) => dirMul * cmpKey(a, b));
      return filtered;
    }
    if (sortBy.startsWith("lang:")) {
      const lang = normalizeLangCode(sortBy.slice(5));
      filtered.sort((a, b) => {
        const av = (entries[a]?.[lang] ?? "").toString();
        const bv = (entries[b]?.[lang] ?? "").toString();

        const aEmpty = !av.trim();
        const bEmpty = !bv.trim();
        if (aEmpty && !bEmpty) return 1;
        if (!aEmpty && bEmpty) return -1;

        const c = cmpText(av, bv);
        if (c) return dirMul * c;
        return cmpKey(a, b);
      });
      return filtered;
    }

    return filtered;
  }

  function clampListPage(filteredCount) {
    const ps = getPageSize();
    const totalPages = Math.max(1, Math.ceil(filteredCount / ps));
    const next = Math.max(0, Math.min(totalPages - 1, Number(state.ui.listPage || 0) | 0));
    if (next !== state.ui.listPage) {
      state.ui.listPage = next;
      saveState();
    }
    return totalPages;
  }

  function buildFilteredRowsHTML() {
    const filteredKeys = getFilteredKeys();
    const totalPages = clampListPage(filteredKeys.length);
    const ps = getPageSize();
    const start = state.ui.listPage * ps;
    const pageKeys = filteredKeys.slice(start, start + ps);

    const rows = pageKeys.map(k => {
      const cells = visibleLangs.map(l => {
        const v = (entries[k] && entries[k][l]) ? entries[k][l] : "";
        const show = cellMode === "wrap" ? (v ?? "") : trimPreview(v);
        const w = Math.max(120, Math.min(800, Number(state.ui.colWidths[l] || 220)));
        const title = showControlSymbols(v);
        const shown = showControlSymbols(show);
        return `<td class="cell" data-col="${escapeHtml(l)}" title="${escapeHtml(title)}" style="width:${w}px">${escapeHtml(shown)}</td>`;
      }).join("");
      return `<tr>
        <td class="keyCell" title="${escapeHtml(k)}"><code>${escapeHtml(k)}</code></td>
        ${cells}
        <td class="nowrap actionsCol">
          <button class="btn small" data-edit="${escapeHtml(k)}">Edit</button>
          <button class="btn small danger ghost" data-delkey="${escapeHtml(k)}">Delete</button>
        </td>
      </tr>`;
    }).join("");

    if (!filteredKeys.length) {
      return `<tr><td colspan="${3 + visibleLangs.length}" class="muted">No matching keys.</td></tr>`;
    }
    if (!pageKeys.length) {
      // Should be rare due to clamp, but keep UI stable.
      return `<tr><td colspan="${3 + visibleLangs.length}" class="muted">No rows on this page.</td></tr>`;
    }
    return rows;
  }

  $("#view").innerHTML = `
    <div class="grid">
      <div class="card">
        <div class="hd">
          <div>
            <h2>List</h2>
          </div>
          <div class="rightTools">
            <button class="btn small" id="btnRenameProject">Rename</button>
          </div>
        </div>
        <div class="bd">
          <div class="row" style="align-items:flex-end;">
            <div style="flex:1; min-width:260px;">
              <label>Project</label>
              <select id="selProject">${projectOptions}</select>
            </div>
            <div style="width:280px;">
              <label>Import</label>
              <button class="btn blue" id="btnImport" type="button">Import…</button>
              <input type="file" id="fileImport" style="display:none" />
            </div>
            <div style="flex:1; min-width:320px;">
              <label>New key</label>
              <div class="row" style="margin-bottom:0;">
                <input id="inpNewKey" placeholder="lp.welcome.title" />
                <button class="btn primary" id="btnAddKey">Add</button>
              </div>
            </div>
          </div>

          <div class="row" style="align-items:flex-end;">
            <div style="flex:1;">
              <label>Languages</label>
              <div class="chips" id="langChips" style="flex-wrap:nowrap; overflow:auto; padding-bottom:2px;">${langChips}</div>
            </div>
            <div style="width:280px;">
              <label>Add language</label>
              <div class="row" style="margin-bottom:0;">
                <input id="inpNewLang" placeholder="e.g. fr-ca"/>
                <button class="btn" id="btnAddLangQuick">Add</button>
              </div>
              <div class="hint langHintStable" id="langHintQuick" style="margin-top:8px;"></div>
            </div>
          </div>

          <div class="row" style="align-items:flex-end;">
            <div style="flex:1; min-width:260px;">
              <label>Filter key</label>
              <input id="inpFilterKey" placeholder="e.g. common." value="${escapeAttr(state.ui.listFilterKey || "")}" />
            </div>
            <div style="flex:1; min-width:260px;">
              <label>Filter translation (any selected language)</label>
              <input id="inpFilterText" placeholder="Search text…" value="${escapeAttr(state.ui.listFilterText || "")}" />
            </div>
          </div>

          <div class="row" style="align-items:flex-end; margin-top:2px;">
            <div style="width:220px;">
              <label>Rows</label>
              <select id="selPageSize">
                ${PAGE_SIZES.map(n => `<option value="${n}" ${n === pageSizeForUI ? "selected" : ""}>${n}</option>`).join("")}
              </select>
            </div>
            <div class="rightTools" style="align-items:flex-end; justify-content:flex-end; flex:1;">
              <div style="width:240px;">
                <label>Sort</label>
                <select id="selSortBy">
                  ${sortOptions.map(o => `<option value="${escapeAttr(o.value)}" ${o.value === sortBy ? "selected" : ""}>${escapeHtml(o.label)}</option>`).join("")}
                </select>
              </div>
              <div style="width:140px;">
                <label>Order</label>
                <button class="btn" id="btnSortDir" type="button">${sortDir === "asc" ? "ASC" : "DES"}</button>
              </div>
              <button class="btn small" id="btnPrevPage" type="button">Prev</button>
              <div class="pill pageInfoPill" id="lblPageInfo" style="white-space:nowrap;">Page 1 / 1</div>
              <button class="btn small" id="btnNextPage" type="button">Next</button>
            </div>
          </div>

          <div class="row" style="margin-top:12px;">
            <div></div>
            <div class="rightTools">
              <button class="btn primary" id="btnExport" type="button">Export…</button>
              <button class="btn ok" id="btnBulkAI">AI bulk translate</button>
            </div>
          </div>

          <div style="margin-top:12px;" class="tableWrap">
            <table id="tblList">
              <thead>
                <tr>
                  <th class="thSortable" data-sort="key" style="width:240px;">Key${sortBy === "key" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}</th>
                  ${visibleLangs.map(l => {
    const w = Math.max(120, Math.min(800, Number(state.ui.colWidths[l] || 220)));
    const isSort = sortBy === ("lang:" + l);
    const arrow = isSort ? (sortDir === "asc" ? " ▲" : " ▼") : "";
    return `<th class="thResizable" data-col="${escapeHtml(l)}" style="width:${w}px;">
                      <div class="thInner">
                        <span class="thSortable" data-sort="lang:${escapeAttr(l)}">${escapeHtml(l.toUpperCase())}${arrow}</span>
                        <span class="colHandle" data-resize="${escapeAttr(l)}" title="Drag to resize"></span>
                      </div>
                    </th>`;
  }).join("")}
                  <th class="actionsCol" style="width:160px;">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${buildFilteredRowsHTML()}
              </tbody>
            </table>
          </div>

          <div class="row" style="margin-top:12px;">
            <div></div>
            <div class="rightTools" style="align-items:flex-end; justify-content:flex-end;">
              <button class="btn small" id="btnPrevPageBottom" type="button">Prev</button>
              <div class="pill pageInfoPill" id="lblPageInfoBottom" style="white-space:nowrap;">Page 1 / 1</div>
              <button class="btn small" id="btnNextPageBottom" type="button">Next</button>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="hd">
          <div>
            <h2>Project tools</h2>
          </div>
        </div>
        <div class="bd">
          <div class="row">
            <div style="flex:1">
              <label>Create new project</label>
              <input id="inpNewProject" placeholder="Project name" />
            </div>
            <button class="btn primary" id="btnCreateProject">Create</button>
          </div>

          <div class="row" style="margin-top:12px;">
            <div style="flex:1">
              <label>Duplicate current project</label>
              <div class="hint">Makes a copy you can experiment with.</div>
            </div>
            <button class="btn" id="btnDuplicate">Duplicate</button>
          </div>

          <div class="row" style="margin-top:12px;">
            <div style="flex:1">
              <label>Delete current project</label>
              <div class="hint dangerText">Deletes the selected project (cannot be undone).</div>
            </div>
            <button class="btn danger" id="btnDeleteProject">Delete</button>
          </div>

          <div class="row" style="margin-top:12px;">
            <div style="flex:1">
              <label>Reset app</label>
              <div class="hint dangerText">Deletes all LocalStorage data for Language Surface.</div>
            </div>
            <button class="btn danger" id="btnReset">Reset</button>
          </div>

          <div style="margin-top:14px;" class="hint">
            Local-only (LocalStorage).
          </div>

          <div style="margin-top:14px;" class="hint">
            Remember to save your work by exporting regularly!
          </div>

          <div class="footerCredit">
            <span class="footerName">Language Surface</span>
            <span class="footerSep">•</span>
            <span>by fernsugi</span>
            <span class="footerSep">•</span>
            <a class="footerLink" href="https://github.com/fernsugi/language-surface" target="_blank" rel="noopener">GitHub</a>
          </div>
        </div>
      </div>
    </div>
  `;

  // Bind
  $("#selProject").addEventListener("change", (e) => setProject(e.target.value));

  const tbody = $("#tblList tbody");
  const rerenderPagingUI = () => {
    const filteredCount = getFilteredKeys().length;
    const totalPages = clampListPage(filteredCount);
    const page = Math.max(0, Number(state.ui.listPage || 0) | 0);
    const lbl = $("#lblPageInfo");
    if (lbl) lbl.textContent = `Page ${page + 1} / ${totalPages} · ${filteredCount} keys`;
    const lblB = $("#lblPageInfoBottom");
    if (lblB) lblB.textContent = `Page ${page + 1} / ${totalPages} · ${filteredCount} keys`;
    const prev = $("#btnPrevPage");
    const next = $("#btnNextPage");
    if (prev) prev.disabled = page <= 0;
    if (next) next.disabled = page >= totalPages - 1;
    const prevB = $("#btnPrevPageBottom");
    const nextB = $("#btnNextPageBottom");
    if (prevB) prevB.disabled = page <= 0;
    if (nextB) nextB.disabled = page >= totalPages - 1;
  };
  const rerenderTbody = () => {
    if (!tbody) return;
    tbody.innerHTML = buildFilteredRowsHTML();
    rerenderPagingUI();
  };

  // init paging label state
  rerenderPagingUI();

  // filters
  $("#inpFilterKey").addEventListener("input", (e) => {
    state.ui.listFilterKey = e.target.value || "";
    state.ui.listPage = 0;
    saveState();
    rerenderTbody();
  });
  $("#inpFilterText").addEventListener("input", (e) => {
    state.ui.listFilterText = e.target.value || "";
    state.ui.listPage = 0;
    saveState();
    rerenderTbody();
  });

  // page size
  $("#selPageSize").addEventListener("change", (e) => {
    const n = Number(e.target.value || 100);
    state.ui.listPageSize = PAGE_SIZES.includes(n) ? n : 100;
    state.ui.listPage = 0;
    saveState();
    renderList();
  });

  // sorting controls
  $("#selSortBy").addEventListener("change", (e) => {
    state.ui.listSortBy = (e.target.value || "key").toString();
    state.ui.listPage = 0;
    saveState();
    renderList();
  });
  $("#btnSortDir").addEventListener("click", () => {
    state.ui.listSortDir = (state.ui.listSortDir === "desc") ? "asc" : "desc";
    state.ui.listPage = 0;
    saveState();
    renderList();
  });

  // prev/next (top + bottom)
  const goPrev = () => {
    state.ui.listPage = Math.max(0, (Number(state.ui.listPage || 0) | 0) - 1);
    saveState();
    renderList();
  };
  const goNext = () => {
    const filteredCount = getFilteredKeys().length;
    const ps = getPageSize();
    const totalPages = Math.max(1, Math.ceil(filteredCount / ps));
    state.ui.listPage = Math.min(totalPages - 1, (Number(state.ui.listPage || 0) | 0) + 1);
    saveState();
    renderList();
  };
  $("#btnPrevPage").addEventListener("click", goPrev);
  $("#btnNextPage").addEventListener("click", goNext);
  $("#btnPrevPageBottom").addEventListener("click", goPrev);
  $("#btnNextPageBottom").addEventListener("click", goNext);

  // language code tips for quick add
  const hintQuick = $("#langHintQuick");
  const inpQuick = $("#inpNewLang");
  const updateHintQuick = () => {
    if (!hintQuick || !inpQuick) return;
    const v = (inpQuick.value || "").trim();
    const active = document.activeElement === inpQuick;
    hintQuick.innerHTML = (active || v) ? renderLangTipsHTML(v) : "";
  };
  updateHintQuick();
  if (inpQuick) {
    inpQuick.addEventListener("input", updateHintQuick);
    inpQuick.addEventListener("focus", updateHintQuick);
    inpQuick.addEventListener("blur", updateHintQuick);
  }

  // resizable columns (language headers)
  $("#tblList").addEventListener("mousedown", (e) => {
    const handle = e.target.closest("[data-resize]");
    if (!handle) return;
    const lang = handle.getAttribute("data-resize");
    const th = handle.closest("th");
    if (!lang || !th) return;
    e.preventDefault();

    const startX = e.clientX;
    const startW = th.getBoundingClientRect().width;

    function onMove(ev) {
      const dx = ev.clientX - startX;
      const next = Math.max(120, Math.min(800, Math.round(startW + dx)));
      th.style.width = next + "px";
      state.ui.colWidths[lang] = next;
      saveState();
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });

  // sorting (click header label; ignore resize handle)
  $("#tblList thead").addEventListener("click", (e) => {
    if (e.target.closest("[data-resize]")) return;
    const target = e.target.closest("[data-sort]");
    if (!target) return;
    const nextSortBy = (target.getAttribute("data-sort") || "").toString();
    if (!nextSortBy) return;

    if (state.ui.listSortBy === nextSortBy) {
      state.ui.listSortDir = (state.ui.listSortDir === "desc") ? "asc" : "desc";
    } else {
      state.ui.listSortBy = nextSortBy;
      state.ui.listSortDir = "asc";
    }
    saveState();
    renderList();
  });

  // lang chips
  $("#langChips").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-langchip]");
    if (!chip) return;
    const lang = chip.getAttribute("data-langchip");
    const vis = new Set(state.ui.visibleLangs || []);
    if (vis.has(lang)) vis.delete(lang); else vis.add(lang);
    const arr = Array.from(vis).filter(l => p.languages.includes(l));
    state.ui.visibleLangs = arr.length ? arr : [p.languages[0]];
    saveState();
    renderList();
  });

  // add key
  $("#btnAddKey").addEventListener("click", async () => {
    const k = normalizeKey($("#inpNewKey").value);
    if (!k) return toast("Enter a key.");
    if (p.entries[k]) return toast("Key already exists.", k);
    p.entries[k] = {};
    for (const l of p.languages) p.entries[k][l] = "";
    p.meta.updatedAt = Date.now();
    saveState();
    location.hash = "#edit/" + encodeURIComponent(k);
  });

  // edit & delete key
  $("#view").addEventListener("click", async (e) => {
    const edit = e.target.closest("[data-edit]");
    if (edit) {
      const k = edit.getAttribute("data-edit");
      location.hash = "#edit/" + encodeURIComponent(k);
    }
    const del = e.target.closest("[data-delkey]");
    if (del) {
      const k = del.getAttribute("data-delkey");
      const ok = await confirmIfNeeded(`Delete key "${k}"? This removes it from the project.`, true);
      if (!ok) return;
      delete p.entries[k];
      p.meta.updatedAt = Date.now();
      saveState();
      toast("Deleted key", k);
      renderList();
    }
  });

  // quick add language
  $("#btnAddLangQuick").addEventListener("click", async () => {
    const lang = normalizeLangCode($("#inpNewLang").value);
    if (!lang) return toast("Enter a language code (e.g. en, ja).");
    await addLanguageToProject(p, lang);
    $("#inpNewLang").value = "";
    renderList();
  });

  // rename project
  $("#btnRenameProject").addEventListener("click", async () => {
    const ok = await openModal({
      title: "Rename project",
      desc: "Change the project name (does not change export filenames unless you export again).",
      bodyHTML: `<label>New name</label><input id="mName" value="${escapeAttr(p.name)}" />`,
      okText: "Rename"
    });
    if (!ok) return;
    const name = ($("#mName")?.value || "").trim();
    if (!name) return toast("Name can't be empty.");
    p.name = name;
    p.meta.updatedAt = Date.now();
    saveState();
    toast("Renamed project", name);
    render();
  });

  // delete project
  $("#btnDeleteProject").addEventListener("click", async () => {
    const ok = await confirmIfNeeded(`Delete project "${p.name}"? This cannot be undone.`, true);
    if (!ok) return;
    const pid = p.id;
    delete state.projects[pid];
    const first = Object.keys(state.projects)[0] || null;
    state.ui.selectedProjectId = first;
    saveState();
    toast("Deleted project", p.name);
    render();
  });

  // create project
  bindCreateProjectControls();

  // duplicate
  $("#btnDuplicate").addEventListener("click", () => {
    const pid = nowId();
    const copy = deepClone(p);
    copy.id = pid;
    copy.name = p.name + " (Copy)";
    copy.meta = { createdAt: Date.now(), updatedAt: Date.now() };
    state.projects[pid] = copy;
    state.ui.selectedProjectId = pid;
    state.ui.visibleLangs = [copy.languages[0]];
    saveState();
    toast("Duplicated project", copy.name);
    render();
  });

  // reset
  $("#btnReset").addEventListener("click", async () => {
    const ok = await confirmIfNeeded("Reset Language Surface? This wipes all app data stored in this browser.", true);
    if (!ok) return;
    localStorage.removeItem(LS_KEY);
    state = initState();
    toast("Reset complete", "A new default project was created.");
    render();
  });

  bindImportControls();

  // export
  $("#btnExport").addEventListener("click", async () => {
    const choice = await openChoiceModal({
      title: "Export",
      desc: "Choose an export format.",
      choices: [
        { label: "CSV", value: "csv" },
        { label: "Single JSON", value: "single_json" },
        { label: "Multiple JSON", value: "multi_json" }
      ]
    });
    if (!choice) return;

    if (choice === "csv") {
      const csv = exportProjectCSV(p);
      downloadFile(safeFileName(p.name) + ".csv", csv, "text/csv;charset=utf-8");
      toast("Exported CSV", p.name);
      return;
    }
    if (choice === "single_json") {
      const json = exportProjectSingleJSON(p);
      downloadFile(safeFileName(p.name) + ".json", json, "application/json;charset=utf-8");
      toast("Exported single JSON", p.name);
      return;
    }
    if (choice === "multi_json") {
      const files = exportProjectMultiJSON(p);
      for (const f of files) {
        downloadFile(f.name, f.content, "application/json;charset=utf-8");
      }
      toast("Exported multiple JSON", `${files.length} file(s)`);
    }
  });

  // AI bulk translate
  $("#btnBulkAI").addEventListener("click", async () => {
    const proj = currentProject();
    if (!proj) return;
    const langs = proj.languages.slice();
    if (langs.length < 2) return toast("Add at least 2 languages to bulk translate.");

    const options = langs.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(l.toUpperCase())}</option>`).join("");
    const ok = await openModal({
      title: "AI bulk translate",
      desc: "Choose a target language. Bulk translate runs key-by-key (one language at a time).",
      bodyHTML: `
        <div class="split">
          <div>
            <label>Source language</label>
            <select id="mSrcLang">${options}</select>
          </div>
          <div>
            <label>Target language</label>
            <select id="mTgtLang">${options}</select>
          </div>
        </div>
        <div style="margin-top:10px;">
          <label>Max characters (0 = infinite)</label>
          <input id="mMaxChars" type="number" min="0" value="${Number(state.settings.defaultMaxChars || 0)}" />
        </div>
        <div class="hint" style="margin-top:10px;">
          Tip: set Source to your strongest language (commonly EN). If API key is missing, go to Settings.
        </div>
        <div class="progressRow">
          <div class="bar"><div id="mBar"></div></div>
          <div class="muted nowrap" id="mProg">0%</div>
        </div>
        <div class="hint" id="mStatus" style="margin-top:8px;"></div>
      `,
      okText: "Start",
      cancelText: "Close"
    });
    if (!ok) return;

    const src = normalizeLangCode($("#mSrcLang").value);
    const tgt = normalizeLangCode($("#mTgtLang").value);
    const maxChars = Number($("#mMaxChars").value || 0);

    if (src === tgt) return toast("Source and target must differ.");
    if (!proj.languages.includes(src) || !proj.languages.includes(tgt)) return toast("Invalid language selection.");

    // Run
    const keys = Object.keys(proj.entries).sort((a, b) => a.localeCompare(b));
    const total = keys.length;
    let done = 0;

    for (const k of keys) {
      const srcText = (proj.entries[k][src] || "").trim();
      const tgtText = (proj.entries[k][tgt] || "").trim();

      $("#mStatus").textContent = `Translating ${k} (${done + 1}/${total})...`;
      if (!srcText) {
        done++;
        updateModalProgress(done, total);
        continue;
      }
      // If already has translation, skip (keep user edits)
      if (tgtText) {
        done++;
        updateModalProgress(done, total);
        continue;
      }
      try {
        const out = await openAITranslate({
          sourceText: srcText,
          sourceLang: src,
          targetLang: tgt,
          maxChars
        });
        proj.entries[k][tgt] = out;
        proj.meta.updatedAt = Date.now();
        saveState();
      } catch (err) {
        console.error(err);
        toast("Bulk AI stopped", err.message || String(err));
        $("#mStatus").textContent = "Stopped due to error.";
        return;
      }
      done++;
      updateModalProgress(done, total);
    }
    $("#mStatus").textContent = "Done.";
    toast("Bulk translate complete", `${tgt.toUpperCase()} filled where empty`);
    renderList();
  });
}

function updateModalProgress(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const bar = $("#mBar");
  const prog = $("#mProg");
  if (bar) bar.style.width = pct + "%";
  if (prog) prog.textContent = pct + "%";
}

function exportProjectCSV(p) {
  const langs = p.languages.slice();
  const keys = Object.keys(p.entries).sort((a, b) => a.localeCompare(b));
  const header = ["key", ...langs].join(",");
  const lines = [header];
  for (const k of keys) {
    const row = [k, ...langs.map(l => p.entries[k]?.[l] ?? "")].map(csvEscape).join(",");
    lines.push(row);
  }
  return lines.join("\n");
}
function csvEscape(v) {
  const s = (v ?? "").toString();
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportProjectSingleJSON(p) {
  // nested: { lp: { hello: { en:"", ja:"" } } }
  const map = {};
  for (const k of Object.keys(p.entries)) {
    map[k] = p.entries[k];
  }
  const nested = toNestedObjectFromDotted(map);
  return JSON.stringify(nested, null, 2);
}

function exportProjectMultiJSON(p) {
  const files = [];
  for (const lang of p.languages) {
    const perLang = {};
    for (const k of Object.keys(p.entries)) {
      perLang[k] = p.entries[k]?.[lang] ?? "";
    }
    const nested = toNestedObjectFromDotted(perLang);
    files.push({
      name: safeFileName(p.name) + "_" + lang + ".json",
      content: JSON.stringify(nested, null, 2)
    });
  }
  return files;
}

/* ---------- Edit View ---------- */
function renderEdit(key) {
  const p = currentProject();
  if (!p) return renderList();
  const entry = p.entries[key];
  if (!entry) {
    $("#view").innerHTML = `
      <div class="card"><div class="bd">
        <div class="row">
          <div>Key not found: <code>${escapeHtml(key)}</code></div>
          <button class="btn" onclick="location.hash='#list'">Back</button>
        </div>
      </div></div>
    `;
    return;
  }

  const langRows = p.languages.map(lang => {
    const val = entry[lang] ?? "";
    return `
      <div class="card" style="margin-bottom:12px;">
        <div class="bd">
          <div class="row" style="align-items:flex-start;">
            <div style="flex:1; min-width:0;">
              <label>${escapeHtml(lang.toUpperCase())}</label>
              <textarea data-lang="${escapeHtml(lang)}" placeholder="Enter translation...">${escapeHtml(val)}</textarea>
              <div class="hint visiblePreview">
                Visible: <span class="muted" data-visible-for="${escapeAttr(lang)}">${escapeHtml(showControlSymbols(val))}</span>
              </div>
            </div>
            <div style="width:210px;">
              <label>AI</label>
              <div class="rightTools">
                <button class="btn small" data-ai="${escapeHtml(lang)}">AI translate</button>
                <input class="small" data-max="${escapeHtml(lang)}" type="number" min="0"
                  value="${Number(state.settings.defaultMaxChars || 0)}"
                  style="width:98px; padding:8px 10px; border-radius: 10px;" />
              </div>
              <div class="hint" style="margin-top:8px;">
                Max chars (0 = infinite). Uses Settings model.
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join("");

  $("#view").innerHTML = `
    <div class="card">
      <div class="hd">
        <div class="editHdLeft">
          <div class="editTitleRow">
            <h2 style="margin:0;">Edit</h2>
            <span class="pill unsaved" id="pillUnsaved" style="visibility:hidden; opacity:0;">UNSAVED</span>
          </div>
        </div>
        <div class="rightTools">
          <button class="btn" id="btnBack" type="button">Back</button>
          <button class="btn" id="btnAddLang">Add language</button>
          <button class="btn danger" id="btnDelLang">Delete language</button>
        </div>
      </div>
      <div class="bd">
        <div class="row">
          <div style="flex:1">
            <label>Key</label>
            <input id="inpKeyRename" value="${escapeAttr(key)}" />
          </div>
          <div class="rightTools" style="align-items:flex-end;">
            <button class="btn" id="btnSaveKeyName">Rename key</button>
            <button class="btn danger" id="btnDeleteKey">Delete key</button>
          </div>
        </div>

        <div style="margin-top:12px;">
          ${langRows}
        </div>

        <div class="row" style="margin-top:10px;">
          <div></div>
          <button class="btn primary" id="btnSaveAll">Save</button>
        </div>
      </div>
    </div>
  `;

  $("#btnBack").addEventListener("click", () => location.hash = "#list");

  let dirty = false;
  const setDirty = (v) => {
    dirty = !!v;
    const pill = $("#pillUnsaved");
    if (pill) {
      pill.style.visibility = dirty ? "visible" : "hidden";
      pill.style.opacity = dirty ? "1" : "0";
    }
  };
  setDirty(false);

  $("#inpKeyRename").addEventListener("input", () => setDirty(true));
  for (const ta of $$("textarea[data-lang]")) {
    ta.addEventListener("input", () => {
      setDirty(true);
      const lang = ta.getAttribute("data-lang") || "";
      const el = $("[data-visible-for=\"" + cssEscape(lang) + "\"]");
      if (el) {
        const shown = showControlSymbols(ta.value);
        el.textContent = shown;
      }
    });
  }

  // save all textareas into entry
  $("#btnSaveAll").addEventListener("click", () => {
    const tas = $$("textarea[data-lang]");
    for (const ta of tas) {
      const lang = ta.getAttribute("data-lang");
      entry[lang] = ta.value;
    }
    p.meta.updatedAt = Date.now();
    saveState();
    toast("Saved", key);
    setDirty(false);
    renderEdit(key);
  });

  // rename key
  $("#btnSaveKeyName").addEventListener("click", async () => {
    const newKey = normalizeKey($("#inpKeyRename").value);
    if (!newKey) return toast("Key cannot be empty.");
    if (newKey === key) return toast("No change.");
    if (p.entries[newKey]) return toast("Target key already exists.", newKey);

    const ok = await confirmIfNeeded(`Rename key "${key}" → "${newKey}"?`, false);
    if (!ok) return;
    p.entries[newKey] = p.entries[key];
    delete p.entries[key];
    p.meta.updatedAt = Date.now();
    saveState();
    toast("Renamed key", newKey);
    location.hash = "#edit/" + encodeURIComponent(newKey);
  });

  // delete key
  $("#btnDeleteKey").addEventListener("click", async () => {
    const ok = await confirmIfNeeded(`Delete key "${key}"?`, true);
    if (!ok) return;
    delete p.entries[key];
    p.meta.updatedAt = Date.now();
    saveState();
    toast("Deleted key", key);
    location.hash = "#list";
  });

  // add language
  $("#btnAddLang").addEventListener("click", async () => {
    const modalPromise = openModal({
      title: "Add language",
      desc: "Adds a language across ALL keys in the project.",
      bodyHTML: `
        <label>Language code</label>
        <input id="mLang" placeholder="e.g. fr, ko, zh-hant" />
        <div class="hint langHintStable" id="mLangHint" style="margin-top:10px;"></div>
      `,
      okText: "Add"
    });

    // Bind tips after modal renders
    setTimeout(() => {
      const inp = $("#mLang");
      const hint = $("#mLangHint");
      if (!inp || !hint) return;
      const update = () => {
        const v = (inp.value || "").trim();
        const active = document.activeElement === inp;
        hint.innerHTML = (active || v) ? renderLangTipsHTML(v) : "";
      };
      update();
      inp.addEventListener("input", update);
      inp.addEventListener("focus", update);
      inp.addEventListener("blur", update);
    }, 0);

    const ok = await modalPromise;
    if (!ok) return;
    const lang = normalizeLangCode($("#mLang").value);
    if (!lang) return toast("Enter a language code.");
    await addLanguageToProject(p, lang);
    renderEdit(key);
  });

  // delete language
  $("#btnDelLang").addEventListener("click", async () => {
    if (p.languages.length <= 1) return toast("Project must have at least 1 language.");
    const options = p.languages.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(l.toUpperCase())}</option>`).join("");
    const ok = await openModal({
      title: "Delete language",
      desc: "This deletes the language across ALL keys (cannot be undone).",
      bodyHTML: `
        <label>Select language</label>
        <select id="mDelLang">${options}</select>
        <div class="hint" style="margin-top:8px;">Tip: export before deleting if you want a backup.</div>
      `,
      okText: "Delete",
      danger: true
    });
    if (!ok) return;
    const lang = normalizeLangCode($("#mDelLang").value);
    const ok2 = await confirmIfNeeded(`Really delete language "${lang.toUpperCase()}" from all keys?`, true);
    if (!ok2) return;
    await deleteLanguageFromProject(p, lang);
    renderEdit(key);
  });

  // AI translate per language
  $("#view").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-ai]");
    if (!btn) return;
    const tgt = btn.getAttribute("data-ai");
    const maxInput = $(`input[data-max="${cssEscape(tgt)}"]`);
    const maxChars = Number((maxInput && maxInput.value) || state.settings.defaultMaxChars || 0);

    const src = normalizeLangCode(state.settings.defaultSourceLang || "en");
    if (!p.languages.includes(src)) {
      toast("Source language not in project", `Set Settings source to one of: ${p.languages.join(", ")}`);
      return;
    }
    if (src === tgt) {
      toast("Target equals source", "Pick a different target language.");
      return;
    }
    const srcText = (entry[src] || "").trim();
    if (!srcText) {
      toast("Nothing to translate", `Source (${src.toUpperCase()}) is empty.`);
      return;
    }
    btn.disabled = true;
    btn.textContent = "Translating...";
    try {
      const out = await openAITranslate({
        sourceText: srcText,
        sourceLang: src,
        targetLang: tgt,
        maxChars
      });
      entry[tgt] = out;
      p.meta.updatedAt = Date.now();
      saveState();
      toast("AI translated", `${src.toUpperCase()} → ${tgt.toUpperCase()}`);
      renderEdit(key);
    } catch (err) {
      console.error(err);
      toast("AI error", err.message || String(err));
    } finally {
      btn.disabled = false;
      btn.textContent = "AI translate";
    }
  });
}

async function addLanguageToProject(p, lang) {
  if (p.languages.includes(lang)) return toast("Language already exists", lang.toUpperCase());
  p.languages.push(lang);
  // add empty entry on every key
  for (const k of Object.keys(p.entries)) {
    p.entries[k][lang] = p.entries[k][lang] ?? "";
  }
  p.meta.updatedAt = Date.now();
  saveState();
  toast("Added language", lang.toUpperCase());
}

async function deleteLanguageFromProject(p, lang) {
  if (!p.languages.includes(lang)) return toast("Language not found", lang);
  if (p.languages.length <= 1) return toast("Cannot delete last language.");
  p.languages = p.languages.filter(l => l !== lang);
  for (const k of Object.keys(p.entries)) {
    delete p.entries[k][lang];
  }
  // update visible langs
  state.ui.visibleLangs = (state.ui.visibleLangs || []).filter(l => p.languages.includes(l));
  if (!state.ui.visibleLangs.length) state.ui.visibleLangs = [p.languages[0]];
  p.meta.updatedAt = Date.now();
  saveState();
  toast("Deleted language", lang.toUpperCase());
}

/* ---------- Settings View ---------- */
function renderSettings() {
  const s = state.settings;
  const p = currentProject();
  const projectLangs = (p && Array.isArray(p.languages)) ? p.languages.slice() : [];
  const selectedSrc = projectLangs.includes(normalizeLangCode(s.defaultSourceLang || ""))
    ? normalizeLangCode(s.defaultSourceLang || "")
    : (projectLangs[0] || "");
  $("#view").innerHTML = `
    <div class="card">
      <div class="hd">
        <div>
          <h2>Settings</h2>
        </div>
        <div class="rightTools">
          <button class="btn" id="btnBackToList">Back</button>
        </div>
      </div>
      <div class="bd">
        <div class="split">
          <div>
            <label>Theme</label>
            <select id="setTheme">
              <option value="dark" ${s.theme === "dark" ? "selected" : ""}>Dark</option>
              <option value="light" ${s.theme === "light" ? "selected" : ""}>Light</option>
            </select>
          </div>
          <div>
            <label>Confirm deletes</label>
            <select id="setConfirm">
              <option value="yes" ${s.confirmDeletes ? "selected" : ""}>Yes</option>
              <option value="no" ${!s.confirmDeletes ? "selected" : ""}>No</option>
            </select>
          </div>
        </div>

        <div style="margin-top:10px;">
          <label>Translation cell display</label>
          <select id="setCellDisplay">
            <option value="clip" ${(s.cellDisplay || "clip") === "clip" ? "selected" : ""}>Clip (single line)</option>
            <option value="wrap" ${(s.cellDisplay || "clip") === "wrap" ? "selected" : ""}>Wrap (expand vertically)</option>
          </select>
        </div>

        <div style="margin-top:12px;">
          <div class="row">
            <div style="flex:1;">
              <label>OpenAI API key (stored locally)</label>
              <input id="setKey" type="password" placeholder="sk-..." value="${escapeAttr(s.openaiApiKey || "")}" />
            </div>
          </div>

          <div class="split" style="margin-top:10px;">
            <div>
              <label>Model</label>
              <input id="setModel" value="${escapeAttr(s.openaiModel || "gpt-4.1-mini")}" />
            </div>
            <div>
              <label>Default source language</label>
              <select id="setSrcLang" ${projectLangs.length ? "" : "disabled"}>
                ${projectLangs.length
      ? projectLangs.map(l => `<option value="${escapeAttr(l)}" ${l === selectedSrc ? "selected" : ""}>${escapeHtml(l.toUpperCase())}</option>`).join("")
      : `<option value="" selected>No languages in project</option>`
    }
              </select>
            </div>
          </div>

          <div style="margin-top:10px;">
            <label>Default max characters (0 = infinite)</label>
            <input id="setMaxChars" type="number" min="0" value="${Number(s.defaultMaxChars || 0)}" />
          </div>
        </div>

        <div class="row" style="margin-top:12px;">
          <div></div>
          <button class="btn primary" id="btnSaveSettings">Save settings</button>
        </div>
      </div>
    </div>
  `;

  $("#btnBackToList").addEventListener("click", () => location.hash = "#list");

  $("#btnSaveSettings").addEventListener("click", () => {
    state.settings.theme = $("#setTheme").value;
    state.settings.confirmDeletes = $("#setConfirm").value === "yes";
    state.settings.cellDisplay = $("#setCellDisplay").value === "wrap" ? "wrap" : "clip";
    state.settings.openaiApiKey = ($("#setKey").value || "").trim();
    state.settings.openaiModel = ($("#setModel").value || "").trim() || "gpt-4.1-mini";
    const picked = normalizeLangCode($("#setSrcLang")?.value || "");
    const langsNow = (currentProject() && Array.isArray(currentProject().languages)) ? currentProject().languages : [];
    if (picked && langsNow.includes(picked)) {
      state.settings.defaultSourceLang = picked;
    }
    state.settings.defaultMaxChars = Math.max(0, Number($("#setMaxChars").value || 0));
    saveState();
    setTheme();
    toast("Saved settings");
    renderSettings();
  });
}

/* ---------- Confirm helpers ---------- */
async function confirmIfNeeded(desc, danger = false) {
  if (state.settings.confirmDeletes === false && danger) return true;
  return await openModal({
    title: danger ? "Confirm" : "Confirm",
    desc,
    bodyHTML: "",
    okText: danger ? "Confirm" : "OK",
    danger
  });
}

/* ---------- Utilities ---------- */
function trimPreview(s, max = 80) {
  s = (s ?? "").toString();
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function showControlSymbols(s) {
  s = (s ?? "").toString();
  // Render common control characters visibly (without changing underlying stored values).
  // Note: order matters (handle CR before LF).
  return s
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
}
function safeFileName(name) {
  return (name || "project").trim().replace(/[^\w\-]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "") || "project";
}
function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

function escapeHtml(str) {
  return (str ?? "").toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function escapeAttr(str) { return escapeHtml(str).replace(/"/g, "&quot;"); }
function cssEscape(str) { return (str ?? "").toString().replace(/"/g, '\\"'); }

/* ---------- boot ---------- */
(function boot() {
  // Ensure hash
  if (!location.hash) location.hash = state.ui.seenWelcome ? "#list" : "#welcome";
  render();
})();
