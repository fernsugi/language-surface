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
    openaiModel: "gpt-4o-mini",
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
    lockedKeys: [], // keys locked to top (not affected by sort/filter)
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
    translationRules: [], // [{from: "word", to: "translation"}, ...]
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
    $("#modalOK").style.display = ""; // Reset display in case it was hidden
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
        { label: "Multiple JSON (one file per language)", value: "multi_json", hint: "Tip: name files like en.json, ja.json, fr-ca.json" },
        { label: "Text file (one line = one key)", value: "text", hint: "Each line becomes a translation key" }
      ]
    });
    if (!mode) return;

    // Ask: current project or new project?
    const currProj = currentProject();
    let importTarget = "new"; // default to new
    if (currProj) {
      const targetChoice = await openChoiceModal({
        title: "Import destination",
        desc: "Where do you want to import?",
        choices: [
          { label: "Current project", value: "current", hint: currProj.name },
          { label: "New project", value: "new" }
        ]
      });
      if (!targetChoice) return;
      importTarget = targetChoice;
    }

    inp.dataset.importMode = mode;
    inp.dataset.importTarget = importTarget;
    if (mode === "csv") {
      inp.multiple = false;
      inp.accept = ".csv,text/csv";
    } else if (mode === "single_json") {
      inp.multiple = false;
      inp.accept = ".json,application/json";
    } else if (mode === "text") {
      inp.multiple = false;
      inp.accept = ".txt,text/plain";
    } else {
      inp.multiple = true;
      inp.accept = ".json,application/json";
    }
    inp.click();
  });

  // import handler
  inp.addEventListener("change", async (e) => {
    const mode = e.target.dataset.importMode || "";
    const importTarget = e.target.dataset.importTarget || "new";
    const files = Array.from((e.target.files || [])).filter(Boolean);
    if (!files.length) return;

    const first = files[0];
    const nameNoExt = first.name.replace(/\.[^.]+$/, "");
    const currProj = currentProject();
    const isCurrentProject = importTarget === "current" && currProj;

    // For new project, ask for project name (skip for current project)
    let projName = isCurrentProject ? currProj.name : nameNoExt;
    if (!isCurrentProject) {
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
      projName = ($("#mImportName")?.value || "").trim() || nameNoExt;
    }

    try {
      if (mode === "csv") {
        if (files.length !== 1) throw new Error("CSV import supports a single file.");
        const text = await first.text();
        if (isCurrentProject) {
          importCSVToCurrentProject(text, currProj);
        } else {
          importCSVToProject(text, projName);
        }
      } else if (mode === "single_json") {
        if (files.length !== 1) throw new Error("Single JSON import supports a single file.");
        const text = await first.text();
        // Decide whether this JSON is a translation-map (multi-language) or a per-language nested JSON.
        let data;
        try { data = JSON.parse(text); }
        catch { throw new Error("Invalid JSON file."); }
        const isTranslationMap = !!jsonToEntriesAndLangs(data);
        if (isTranslationMap) {
          if (isCurrentProject) {
            importJSONToCurrentProject(text, currProj, first.name);
          } else {
            importJSONToProject(text, projName, first.name);
          }
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
          if (isCurrentProject) {
            importJSONToCurrentProject(text, currProj, first.name, lang);
          } else {
            importJSONToProject(text, projName, first.name, lang);
          }
        }
      } else if (mode === "multi_json") {
        const bad = files.find(f => !f.name.toLowerCase().endsWith(".json"));
        if (bad) throw new Error("Multi-file import supports JSON files only.");
        if (isCurrentProject) {
          await importJSONFilesToCurrentProject(files, currProj);
        } else {
          await importJSONFilesToProject(files, projName);
        }
      } else if (mode === "text") {
        if (files.length !== 1) throw new Error("Text import supports a single file.");
        const text = await first.text();
        const lines = text.split(/\r?\n/).filter(line => line.trim());
        if (!lines.length) throw new Error("Text file is empty or has no valid lines.");

        // For current project: show existing languages + enter new
        // For new project: only enter new
        const projectLangs = isCurrentProject ? (currProj.languages || []) : [];
        const defaultLang = state.settings.defaultSourceLang || "en";

        let langSelectHTML = "";
        let langInputStyle = "";
        if (isCurrentProject && projectLangs.length) {
          const langOptionsHTML = `<option value="">(enter new)</option>` +
            projectLangs.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(l.toUpperCase())}</option>`).join("");
          langSelectHTML = `<select id="mTextLangSelect" style="margin-bottom:8px;" onchange="
            var inp = document.getElementById('mTextLang');
            var hint = document.getElementById('mTextLangHint');
            if(this.value) {
              inp.value = this.value;
              inp.style.display = 'none';
              if(hint) hint.style.display = 'none';
            } else {
              inp.value = '';
              inp.style.display = '';
              if(hint) hint.style.display = '';
              inp.focus();
            }
          ">${langOptionsHTML}</select>`;
        }

        // Setup hints after a short delay (modal needs to render first)
        const setupLangHints = () => {
          const hintEl = $("#mTextLangHint");
          const langInp = $("#mTextLang");
          if (hintEl && langInp) {
            const updateHint = () => {
              const v = (langInp.value || "").trim();
              const visible = langInp.style.display !== "none";
              hintEl.innerHTML = visible ? renderLangTipsHTML(v) : "";
            };
            updateHint();
            langInp.addEventListener("input", updateHint);
            langInp.addEventListener("focus", updateHint);
          }
        };
        setTimeout(setupLangHints, 50);

        const okLang = await openModal({
          title: "Text file import",
          desc: isCurrentProject
            ? `Found ${lines.length} lines. Import to "${currProj.name}".`
            : `Found ${lines.length} lines. Specify the language for these translations.`,
          bodyHTML: `
            <label>Language code</label>
            ${langSelectHTML}
            <input id="mTextLang" placeholder="e.g. en, ja, zh-hans" value="${escapeAttr(defaultLang)}" ${langInputStyle} />
            <div id="mTextLangHint" class="hint langHintStable" style="margin-top:8px;"></div>
            <div class="hint" style="margin-top:8px;">Each line will become a key with this language's value.</div>
            <div style="margin-top:12px;">
              <label>Key prefix (optional)</label>
              <input id="mTextKeyPrefix" placeholder="e.g. item, message" value="line" />
              <div class="hint" style="margin-top:4px;">Keys will be named: prefix_1, prefix_2, etc.</div>
            </div>
          `,
          okText: "Import"
        });

        if (!okLang) throw new Error("Import cancelled.");
        const lang = normalizeLangCode($("#mTextLang")?.value || "");
        if (!lang) throw new Error("Language code is required.");
        const keyPrefix = ($("#mTextKeyPrefix")?.value || "").trim() || "line";

        if (isCurrentProject) {
          importTextToCurrentProject(lines, currProj, lang, keyPrefix);
        } else {
          importTextToProject(lines, projName, lang, keyPrefix);
        }
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

      const action = isCurrentProject ? "Imported to project" : "Imported project";
      toast(action, `${projName} • ${langs.join(", ") || "(no langs)"} • ${keyCount.toLocaleString()} keys`);
      render();
    } catch (err) {
      console.error(err);
      toast("Import failed", err.message || String(err));
    } finally {
      e.target.value = "";
      delete e.target.dataset.importMode;
      delete e.target.dataset.importTarget;
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

function importTextToProject(lines, projectName, lang, keyPrefix = "line") {
  const entries = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const key = `${keyPrefix}_${i + 1}`;
    entries[key] = { [lang]: line };
  }

  if (!Object.keys(entries).length) throw new Error("No valid lines found in text file.");

  const pid = nowId();
  state.projects[pid] = {
    id: pid,
    name: projectName || "Imported Text",
    languages: [lang],
    entries,
    meta: { createdAt: Date.now(), updatedAt: Date.now() }
  };
  state.ui.selectedProjectId = pid;
  state.ui.visibleLangs = [lang];
  saveState();
}

// --- Import to CURRENT project functions ---

function importCSVToCurrentProject(csvText, proj) {
  const rows = parseCSV(csvText);
  const header = rows[0].map(h => h.trim());
  if (header.length < 2) throw new Error("CSV header must include: key, <language...>");
  if (header[0].toLowerCase() !== "key") throw new Error('CSV first column must be named "key".');

  const langs = header.slice(1).map(normalizeLangCode).filter(Boolean);
  if (!langs.length) throw new Error("CSV must include at least one language column (e.g., en, ja).");

  let addedKeys = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const key = normalizeKey(row[0] || "");
    if (!key) continue;
    if (!proj.entries[key]) {
      proj.entries[key] = {};
      addedKeys++;
    }
    for (let c = 1; c < header.length; c++) {
      const lang = langs[c - 1];
      proj.entries[key][lang] = (row[c] ?? "").toString();
    }
  }

  // Add new languages
  for (const lang of langs) {
    if (!proj.languages.includes(lang)) proj.languages.push(lang);
  }

  proj.meta.updatedAt = Date.now();
  saveState();
}

function importJSONToCurrentProject(jsonText, proj, fileName = "", forcedLang = "") {
  let data;
  try { data = JSON.parse(jsonText); } catch { throw new Error("Invalid JSON."); }

  const parsed = jsonToEntriesAndLangs(data);
  if (parsed) {
    // Translation map format
    for (const key of Object.keys(parsed.entries)) {
      if (!proj.entries[key]) proj.entries[key] = {};
      Object.assign(proj.entries[key], parsed.entries[key]);
    }
    for (const lang of parsed.langs) {
      if (!proj.languages.includes(lang)) proj.languages.push(lang);
    }
  } else {
    // Single-language format
    const lang = forcedLang || inferLangFromFileName(fileName);
    if (!lang) throw new Error("Cannot determine language. Provide a language code.");
    const { obj } = maybeUnwrapRootWrapper(data);
    const flatVals = flattenNestedValuesForLang(obj, lang);
    for (const k of Object.keys(flatVals)) {
      const key = normalizeKey(k);
      if (!key || shouldSkipImportedKey(key)) continue;
      if (!proj.entries[key]) proj.entries[key] = {};
      proj.entries[key][lang] = (flatVals[k] ?? "").toString();
    }
    if (!proj.languages.includes(lang)) proj.languages.push(lang);
  }

  proj.meta.updatedAt = Date.now();
  saveState();
}

async function importJSONFilesToCurrentProject(files, proj) {
  for (const file of files) {
    const text = await file.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`Invalid JSON: ${file.name}`); }
    const { obj, inferredLang } = maybeUnwrapRootWrapper(data);
    let lang = inferLangFromFileName(file.name) || inferredLang;

    // Check if translation-map format
    const parsed = jsonToEntriesAndLangs(data);
    if (parsed) {
      for (const key of Object.keys(parsed.entries)) {
        if (!proj.entries[key]) proj.entries[key] = {};
        Object.assign(proj.entries[key], parsed.entries[key]);
      }
      for (const l of parsed.langs) {
        if (!proj.languages.includes(l)) proj.languages.push(l);
      }
      continue;
    }

    if (!lang) throw new Error(`Cannot infer language from filename: ${file.name}. Name files like "en.json", "ja.json".`);

    const flatVals = flattenNestedValuesForLang(obj, lang);
    for (const k of Object.keys(flatVals)) {
      const key = normalizeKey(k);
      if (!key || shouldSkipImportedKey(key)) continue;
      if (!proj.entries[key]) proj.entries[key] = {};
      proj.entries[key][lang] = (flatVals[k] ?? "").toString();
    }
    if (!proj.languages.includes(lang)) proj.languages.push(lang);
  }

  proj.meta.updatedAt = Date.now();
  saveState();
}

function importTextToCurrentProject(lines, proj, lang, keyPrefix = "line") {
  let addedKeys = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const key = `${keyPrefix}_${i + 1}`;
    if (!proj.entries[key]) {
      proj.entries[key] = {};
      addedKeys++;
    }
    proj.entries[key][lang] = line;
  }

  if (!proj.languages.includes(lang)) proj.languages.push(lang);
  proj.meta.updatedAt = Date.now();
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
  const model = (state.settings.openaiModel || "gpt-4o-mini").trim();

  const limitLine = maxChars && Number(maxChars) > 0
    ? `- Output must be <= ${Number(maxChars)} characters.\n`
    : "";

  // Get translation rules from current project (filtered by language pair)
  const proj = currentProject();
  const allRules = (proj && proj.translationRules) ? proj.translationRules : [];
  // Filter rules that match this source→target language pair (or "all")
  const rules = allRules.filter(r => {
    const rSrc = (r.sourceLang || "").toLowerCase();
    const rTgt = (r.targetLang || "").toLowerCase();
    const srcMatch = rSrc === "all" || rSrc === normalizeLangCode(sourceLang);
    const tgtMatch = rTgt === "all" || rTgt === normalizeLangCode(targetLang);
    return srcMatch && tgtMatch;
  });
  let rulesSection = "";
  if (rules.length > 0) {
    const ruleLines = rules.map(r => `  "${r.from}" → "${r.to}"${r.from.includes("*") ? " (* = single character wildcard)" : ""}`).join("\n");
    rulesSection = `- IMPORTANT: You MUST follow these translation rules exactly (glossary/terminology). Match words CASE-INSENSITIVELY (e.g. "hello", "Hello", "HELLO" all match). Preserve the original casing style in output when possible:
${ruleLines}
`;
  }

  const prompt =
    `You are a professional localization translator.
Translate the text from ${sourceLang.toUpperCase()} to ${targetLang.toUpperCase()}.

CRITICAL RULES:
- Output MUST be 100% in ${targetLang.toUpperCase()} script/characters ONLY.
- Do NOT include ANY ${sourceLang.toUpperCase()} characters (hiragana, katakana, kanji, hangul, etc.) in output.
- Translate EVERYTHING including common words, terms, and phrases.
- TRANSLITERATE all names (people, places, characters) to ${targetLang.toUpperCase()} script. For example: Japanese katakana names like "イル・ミナ" must become Chinese characters like "伊尔·米娜", Korean names must be written in target script, etc.
- Keep placeholders intact (e.g. {name}, %s, %d, {{var}}, ${'${var}'}, alphanumeric codes like "Rep.F").
- Keep punctuation style appropriate for ${targetLang.toUpperCase()} and preserve line breaks (\\n).
${limitLine}${rulesSection}${extraContext ? "- Extra context: " + extraContext + "\n" : ""}
Return ONLY the translated text. No quotes, no explanations, no original text.

Text to translate:
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
    const lockedKeys = (state.ui.lockedKeys || []).filter(k => p.entries[k]);

    // Separate locked and unlocked keys
    const lockedSet = new Set(lockedKeys);
    const unlockedKeys = keysAll.filter(k => !lockedSet.has(k));

    const filtered = unlockedKeys.filter((k) => {
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
    } else if (sortBy.startsWith("lang:")) {
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
    }

    // Locked keys always at top (in their original order), not affected by filter/sort
    return [...lockedKeys, ...filtered];
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
    const lockedSet = new Set(state.ui.lockedKeys || []);

    const rows = pageKeys.map(k => {
      const isLocked = lockedSet.has(k);
      const cells = visibleLangs.map(l => {
        const v = (entries[k] && entries[k][l]) ? entries[k][l] : "";
        const show = cellMode === "wrap" ? (v ?? "") : trimPreview(v);
        const w = Math.max(120, Math.min(800, Number(state.ui.colWidths[l] || 220)));
        const title = showControlSymbols(v);
        const shown = showControlSymbols(show);
        return `<td class="cell" data-col="${escapeHtml(l)}" title="${escapeHtml(title)}" style="width:${w}px">${escapeHtml(shown)}</td>`;
      }).join("");
      const lockIcon = isLocked ? "🔒" : "📌";
      const lockTitle = isLocked ? "Unlock (remove from top)" : "Lock to top";
      return `<tr${isLocked ? ' style="background:rgba(20,184,166,.08);"' : ""}>
        <td class="keyCell" title="Click to copy" data-copykey="${escapeHtml(k)}" style="cursor:pointer;"><code>${escapeHtml(k)}</code></td>
        ${cells}
        <td class="nowrap actionsCol">
          <button class="btn small" data-lock="${escapeHtml(k)}" title="${lockTitle}">${lockIcon}</button>
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
                <div class="inputWrap" style="flex:1;">
                  <input id="inpNewKey" placeholder="lp.welcome.title" />
                  <button type="button" class="inputClear" data-clear="inpNewKey">×</button>
                </div>
                <button class="btn primary" id="btnAddKey">Add</button>
              </div>
              <div class="hint langHintStable" id="keyHint" style="margin-top:6px;"></div>
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
                <div class="inputWrap" style="flex:1;">
                  <input id="inpNewLang" placeholder="e.g. fr-ca"/>
                  <button type="button" class="inputClear" data-clear="inpNewLang">×</button>
                </div>
                <button class="btn" id="btnAddLangQuick">Add</button>
              </div>
              <div class="hint langHintStable" id="langHintQuick" style="margin-top:8px;"></div>
            </div>
          </div>

          <div class="row" style="align-items:flex-end;">
            <div style="flex:1; min-width:260px;">
              <label>Filter key</label>
              <div class="inputWrap">
                <input id="inpFilterKey" placeholder="e.g. common." value="${escapeAttr(state.ui.listFilterKey || "")}" />
                <button type="button" class="inputClear" data-clear="inpFilterKey">×</button>
              </div>
            </div>
            <div style="flex:1; min-width:260px;">
              <label>Filter translation (any selected language)</label>
              <div class="inputWrap">
                <input id="inpFilterText" placeholder="Search text…" value="${escapeAttr(state.ui.listFilterText || "")}" />
                <button type="button" class="inputClear" data-clear="inpFilterText">×</button>
              </div>
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
              <button class="btn small" id="btnClearLang" type="button">Clear</button>
              <button class="btn small" id="btnReplaceAll" type="button">Replace</button>
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
              <label>Translation rules</label>
              <div class="hint">Define word mappings AI must follow during translation.</div>
            </div>
            <button class="btn" id="btnRules">Rules (${(p.translationRules || []).length})</button>
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

  // clear buttons for inputs
  $("#view").addEventListener("click", (e) => {
    const clearBtn = e.target.closest("[data-clear]");
    if (!clearBtn) return;
    const targetId = clearBtn.getAttribute("data-clear");
    const input = $("#" + targetId);
    if (!input) return;
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
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

  // key hints (show 1-2 existing keys as reference)
  const keyHint = $("#keyHint");
  const inpNewKey = $("#inpNewKey");
  const renderKeyHintsHTML = (query) => {
    const q = (query || "").trim().toLowerCase();
    // Get up to 2 existing keys that match the query prefix
    const matches = keysAll
      .filter(k => !q || k.toLowerCase().startsWith(q) || k.toLowerCase().includes(q))
      .slice(0, 2);
    if (!matches.length && !q) {
      // Show first 2 keys as examples when empty
      const examples = keysAll.slice(0, 2);
      if (!examples.length) return "";
      return `<span class="muted">e.g.</span> ${examples.map(k => `<code>${escapeHtml(k)}</code>`).join(", ")}`;
    }
    if (!matches.length) return "";
    return matches.map(k => `<code>${escapeHtml(k)}</code>`).join(", ");
  };
  const updateKeyHint = () => {
    if (!keyHint || !inpNewKey) return;
    const v = (inpNewKey.value || "").trim();
    const active = document.activeElement === inpNewKey;
    keyHint.innerHTML = active ? renderKeyHintsHTML(v) : "";
  };
  updateKeyHint();
  if (inpNewKey) {
    inpNewKey.addEventListener("input", updateKeyHint);
    inpNewKey.addEventListener("focus", updateKeyHint);
    inpNewKey.addEventListener("blur", updateKeyHint);
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

  // edit, delete, lock, copy key
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
      // Also remove from locked keys if present
      state.ui.lockedKeys = (state.ui.lockedKeys || []).filter(lk => lk !== k);
      p.meta.updatedAt = Date.now();
      saveState();
      toast("Deleted key", k);
      renderList();
    }
    const lock = e.target.closest("[data-lock]");
    if (lock) {
      const k = lock.getAttribute("data-lock");
      const locked = state.ui.lockedKeys || [];
      if (locked.includes(k)) {
        state.ui.lockedKeys = locked.filter(lk => lk !== k);
        toast("Unlocked", k);
      } else {
        state.ui.lockedKeys = [...locked, k];
        toast("Locked to top", k);
      }
      saveState();
      rerenderTbody();
    }
    const copyKey = e.target.closest("[data-copykey]");
    if (copyKey) {
      const k = copyKey.getAttribute("data-copykey");
      try {
        await navigator.clipboard.writeText(k);
        toast("Copied", k);
      } catch (err) {
        toast("Copy failed", err.message || String(err));
      }
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

  // translation rules
  $("#btnRules").addEventListener("click", async () => {
    // Ensure rules array exists
    if (!p.translationRules) p.translationRules = [];

    const langOptions = `<option value="all">ALL</option>` + p.languages.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(l.toUpperCase())}</option>`).join("");

    const renderRulesList = () => {
      const rules = p.translationRules || [];
      if (!rules.length) {
        return '<div class="muted" style="text-align:center; padding:12px;">No rules yet. Add one below.</div>';
      }
      return rules.map((r, i) => `
        <div class="row" style="margin-bottom:8px; padding:8px; background:rgba(255,255,255,.03); border-radius:8px;">
          <div style="flex:1; font-size:13px;">
            <span class="pill" style="font-size:10px; padding:2px 6px;">${escapeHtml((r.sourceLang || "?").toUpperCase())} → ${escapeHtml((r.targetLang || "?").toUpperCase())}</span>
            <code style="margin-left:8px;">${escapeHtml(r.from)}</code>
            <span class="muted" style="margin:0 8px;">→</span>
            <code>${escapeHtml(r.to)}</code>
          </div>
          <button class="btn small danger ghost" data-delrule="${i}">×</button>
        </div>
      `).join("");
    };

    const showRulesModal = async () => {
      const back = $("#modalBack");
      $("#modalTitle").textContent = "Translation Rules";
      $("#modalDesc").textContent = "AI will follow these word mappings during translation. Use * as wildcard for single character.";
      $("#modalBody").innerHTML = `
        <div id="rulesList" style="max-height:200px; overflow:auto; margin-bottom:12px;">
          ${renderRulesList()}
        </div>
        <div style="padding-top:12px; border-top:1px solid var(--border);">
          <div class="row" style="margin-bottom:8px;">
            <div style="width:100px;">
              <label>From lang</label>
              <select id="mRuleSrcLang">${langOptions}</select>
            </div>
            <div style="width:100px;">
              <label>To lang</label>
              <select id="mRuleTgtLang">${langOptions}</select>
            </div>
          </div>
          <div class="row" style="margin-bottom:8px;">
            <div style="flex:1;">
              <label>Source text</label>
              <div class="inputWrap">
                <input id="mRuleFrom" placeholder="Original word" />
                <button type="button" class="inputClear" data-clear="mRuleFrom">×</button>
              </div>
            </div>
            <div style="flex:1;">
              <label>Translation</label>
              <div class="inputWrap">
                <input id="mRuleTo" placeholder="Translated word" />
                <button type="button" class="inputClear" data-clear="mRuleTo">×</button>
              </div>
            </div>
            <button class="btn primary" id="btnAddRule" style="align-self:flex-end;">Add</button>
          </div>
          <div class="hint">
            Use * as wildcard for single character (e.g. "Lv.*" matches "Lv.1", "Lv.2", etc.)
          </div>
        </div>
      `;
      $("#modalOK").style.display = "none";
      $("#modalCancel").textContent = "Close";
      back.style.display = "flex";

      // Set second language as default target if available
      if (p.languages.length > 1) {
        const tgtSelect = $("#mRuleTgtLang");
        if (tgtSelect) tgtSelect.value = p.languages[1];
      }

      const updateList = () => {
        const listEl = $("#rulesList");
        if (listEl) listEl.innerHTML = renderRulesList();
      };

      // Add rule handler
      const addRule = () => {
        const sourceLang = ($("#mRuleSrcLang")?.value || "").trim().toLowerCase();
        const targetLang = ($("#mRuleTgtLang")?.value || "").trim().toLowerCase();
        const from = ($("#mRuleFrom")?.value || "").trim();
        const to = ($("#mRuleTo")?.value || "").trim();
        if (!sourceLang || !targetLang) return toast("Select languages.");
        if (sourceLang === targetLang && sourceLang !== "all") return toast("Source and target must differ.");
        if (!from) return toast("Enter source text.");
        if (!to) return toast("Enter translation.");
        // Check for duplicate (same from text + same language pair)
        if (p.translationRules.some(r => r.from === from && r.sourceLang === sourceLang && r.targetLang === targetLang)) {
          return toast("Rule already exists", from);
        }
        p.translationRules.push({ sourceLang, targetLang, from, to });
        p.meta.updatedAt = Date.now();
        saveState();
        $("#mRuleFrom").value = "";
        $("#mRuleTo").value = "";
        updateList();
        toast("Added rule", `${from} → ${to}`);
      };

      $("#btnAddRule").addEventListener("click", addRule);

      // Delete rule handler
      $("#modalBody").addEventListener("click", (e) => {
        const delBtn = e.target.closest("[data-delrule]");
        if (!delBtn) return;
        const idx = parseInt(delBtn.getAttribute("data-delrule"), 10);
        if (isNaN(idx) || idx < 0 || idx >= p.translationRules.length) return;
        const removed = p.translationRules.splice(idx, 1)[0];
        p.meta.updatedAt = Date.now();
        saveState();
        updateList();
        toast("Removed rule", removed.from);
      });

      // Clear button handler
      $("#modalBody").addEventListener("click", (e) => {
        const clearBtn = e.target.closest("[data-clear]");
        if (!clearBtn) return;
        const targetId = clearBtn.getAttribute("data-clear");
        const input = $("#" + targetId);
        if (input) {
          input.value = "";
          input.focus();
        }
      });

      // Close handler using onclick (not addEventListener to avoid stacking)
      $("#modalCancel").onclick = () => {
        back.style.display = "none";
        $("#modalOK").style.display = ""; // Reset OK button
        renderList(); // Refresh to update button count
      };
    };

    await showRulesModal();
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

  // clear language translations (in filtered keys)
  $("#btnClearLang").addEventListener("click", async () => {
    const filteredKeys = getFilteredKeys();
    const hasFilter = (state.ui.listFilterKey || "").trim() || (state.ui.listFilterText || "").trim();
    const langOptions = p.languages.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(l.toUpperCase())}</option>`).join("");

    const ok = await openModal({
      title: "Clear translations",
      desc: "Clear all translations for a language in filtered keys.",
      bodyHTML: `
        <div style="margin-bottom:12px; padding:10px; border-radius:10px; background:rgba(20,184,166,.1); border:1px solid rgba(20,184,166,.3);">
          <strong>${filteredKeys.length}</strong> key(s) will be affected${hasFilter ? " (filtered)" : ""}.
          ${hasFilter ? '<div class="hint" style="margin-top:4px;">Clear filters to affect all keys.</div>' : ""}
        </div>
        <div>
          <label>Language to clear</label>
          <select id="mClearLang">${langOptions}</select>
        </div>
        <div class="hint" style="margin-top:10px;">
          This will set all translations for the selected language to empty strings.
        </div>
      `,
      okText: "Next",
      cancelText: "Cancel"
    });
    if (!ok) return;

    const lang = normalizeLangCode($("#mClearLang")?.value || "");
    if (!lang) return toast("Select a language.");

    // Count non-empty translations
    let nonEmptyCount = 0;
    for (const k of filteredKeys) {
      const val = (p.entries[k]?.[lang] ?? "").toString().trim();
      if (val) nonEmptyCount++;
    }

    if (nonEmptyCount === 0) {
      return toast("Nothing to clear", `${lang.toUpperCase()} is already empty in filtered keys.`);
    }

    // Confirmation modal
    const confirmOk = await openModal({
      title: "Confirm clear",
      desc: `Clear all ${lang.toUpperCase()} translations?`,
      bodyHTML: `
        <div class="hint">
          <strong>${nonEmptyCount}</strong> translation(s) will be cleared.
        </div>
        <div class="hint dangerText" style="margin-top:10px;">
          This cannot be undone. Consider exporting first.
        </div>
      `,
      okText: "Clear All",
      cancelText: "Cancel",
      danger: true
    });
    if (!confirmOk) return;

    // Perform clear
    for (const k of filteredKeys) {
      p.entries[k][lang] = "";
    }
    p.meta.updatedAt = Date.now();
    saveState();
    toast("Cleared", `${nonEmptyCount} ${lang.toUpperCase()} translation(s)`);
    renderList();
  });

  // replace all (in filtered keys)
  $("#btnReplaceAll").addEventListener("click", async () => {
    const langOptions = visibleLangs.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(l.toUpperCase())}</option>`).join("");
    const ok = await openModal({
      title: "Replace text",
      desc: "Replace text in filtered keys (visible languages only).",
      bodyHTML: `
        <div style="margin-bottom:10px;">
          <label>Language</label>
          <select id="mReplaceLang">${langOptions}</select>
        </div>
        <div style="margin-bottom:10px;">
          <label>Find</label>
          <input id="mReplaceFind" placeholder="Text to find..." />
        </div>
        <div>
          <label>Replace with</label>
          <input id="mReplaceWith" placeholder="Replacement text..." />
        </div>
        <div class="hint" style="margin-top:10px;">
          This will only affect keys matching the current filter.
        </div>
      `,
      okText: "Preview",
      cancelText: "Cancel"
    });
    if (!ok) return;

    const lang = normalizeLangCode($("#mReplaceLang")?.value || "");
    const findText = $("#mReplaceFind")?.value || "";
    const replaceWith = $("#mReplaceWith")?.value || "";

    if (!lang) return toast("Select a language.");
    if (!findText) return toast("Enter text to find.");

    // Get filtered keys and count matches
    const filteredKeys = getFilteredKeys();
    let matchCount = 0;
    let keyCount = 0;
    const affectedKeys = [];

    for (const k of filteredKeys) {
      const val = (p.entries[k]?.[lang] ?? "").toString();
      if (val.includes(findText)) {
        const occurrences = val.split(findText).length - 1;
        matchCount += occurrences;
        keyCount++;
        affectedKeys.push(k);
      }
    }

    if (keyCount === 0) {
      return toast("No matches found", `"${findText}" not found in ${lang.toUpperCase()}`);
    }

    // Confirmation modal
    const confirmOk = await openModal({
      title: "Confirm replace",
      desc: `Replace "${findText}" with "${replaceWith}" in ${lang.toUpperCase()}?`,
      bodyHTML: `
        <div class="hint">
          <strong>${matchCount}</strong> occurrence(s) in <strong>${keyCount}</strong> key(s) will be replaced.
        </div>
        <div style="margin-top:10px; max-height:150px; overflow:auto; font-size:12px;">
          ${affectedKeys.slice(0, 10).map(k => `<div><code>${escapeHtml(k)}</code></div>`).join("")}
          ${affectedKeys.length > 10 ? `<div class="muted">...and ${affectedKeys.length - 10} more</div>` : ""}
        </div>
      `,
      okText: "Replace All",
      cancelText: "Cancel",
      danger: true
    });
    if (!confirmOk) return;

    // Perform replacement
    for (const k of affectedKeys) {
      const val = (p.entries[k]?.[lang] ?? "").toString();
      p.entries[k][lang] = val.split(findText).join(replaceWith);
    }
    p.meta.updatedAt = Date.now();
    saveState();
    toast("Replaced", `${matchCount} occurrence(s) in ${keyCount} key(s)`);
    renderList();
  });

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
    const filteredKeys = getFilteredKeys();
    const hasFilter = (state.ui.listFilterKey || "").trim() || (state.ui.listFilterText || "").trim();
    const ok = await openModal({
      title: "AI bulk translate",
      desc: "Bulk translate runs key-by-key (one language at a time).",
      bodyHTML: `
        <div style="margin-bottom:12px; padding:10px; border-radius:10px; background:rgba(20,184,166,.1); border:1px solid rgba(20,184,166,.3);">
          <strong>${filteredKeys.length}</strong> key(s) will be processed${hasFilter ? " (filtered)" : ""}.
          ${hasFilter ? '<div class="hint" style="margin-top:4px;">Clear filters to translate all keys.</div>' : ""}
        </div>
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
      `,
      okText: "Start",
      cancelText: "Cancel"
    });
    if (!ok) return;

    const src = normalizeLangCode($("#mSrcLang").value);
    const tgt = normalizeLangCode($("#mTgtLang").value);
    const maxChars = Number($("#mMaxChars").value || 0);

    if (src === tgt) return toast("Source and target must differ.");
    if (!proj.languages.includes(src) || !proj.languages.includes(tgt)) return toast("Invalid language selection.");

    // Open progress modal (non-blocking)
    const back = $("#modalBack");
    const modalCancel = $("#modalCancel");
    const modalOK = $("#modalOK");

    // Reset modal state completely
    modalOK.style.display = "none";
    modalCancel.textContent = "Cancel";
    modalCancel.disabled = false;

    // Remove any existing listeners by cloning
    const newModalCancel = modalCancel.cloneNode(true);
    modalCancel.parentNode.replaceChild(newModalCancel, modalCancel);

    $("#modalTitle").textContent = "Translating...";
    $("#modalDesc").textContent = `${src.toUpperCase()} → ${tgt.toUpperCase()}`;
    $("#modalBody").innerHTML = `
      <div style="margin-bottom:12px; padding:10px; border-radius:10px; background:rgba(251,191,36,.1); border:1px solid rgba(251,191,36,.4); font-size:12px;">
        <strong>Do not close this tab</strong> while translation is in progress. Your work is saved after each translation.
      </div>
      <div class="progressRow">
        <div class="bar"><div id="mBar" style="width:0%"></div></div>
        <div class="muted nowrap" id="mProg">0%</div>
      </div>
      <div id="mStatus" style="margin-top:10px; font-size:13px;"></div>
      <div id="mCurrentKey" style="margin-top:6px; font-size:12px; color:var(--muted); word-break:break-all;"></div>
    `;
    back.style.display = "flex";

    let cancelled = false;
    const cancelBtn = $("#modalCancel");
    cancelBtn.onclick = () => {
      cancelled = true;
      cancelBtn.textContent = "Cancelling...";
      cancelBtn.disabled = true;
    };

    const updateProgress = (done, total, status, currentKey = "") => {
      const pct = total ? Math.round((done / total) * 100) : 0;
      const bar = $("#mBar");
      const prog = $("#mProg");
      const statusEl = $("#mStatus");
      const keyEl = $("#mCurrentKey");
      if (bar) bar.style.width = pct + "%";
      if (prog) prog.textContent = `${pct}% (${done}/${total})`;
      if (statusEl) statusEl.textContent = status;
      if (keyEl) keyEl.textContent = currentKey ? `Key: ${currentKey}` : "";
    };

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    const translateWithRetry = async (params, maxRetries = 5) => {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        if (cancelled) throw new Error("Cancelled by user");
        try {
          return await openAITranslate(params);
        } catch (err) {
          const errMsg = err.message || String(err);

          // Check for CORS/network errors (usually means we're blocked)
          if (errMsg.includes("Failed to fetch") || errMsg.includes("CORS") || errMsg.includes("NetworkError")) {
            throw new Error("Network error - you may be rate limited. Please wait a few minutes and try again.");
          }

          // Check for rate limit error
          if (errMsg.includes("429") || errMsg.toLowerCase().includes("rate limit")) {
            // Extract wait time from error message if available
            const waitMatch = errMsg.match(/try again in (\d+)s/i);
            const waitTime = waitMatch ? (parseInt(waitMatch[1], 10) + 2) * 1000 : (attempt * 15000);

            if (attempt < maxRetries) {
              updateProgress(done, total, `Rate limited. Waiting ${Math.round(waitTime/1000)}s before retry (${attempt}/${maxRetries})...`, params.key || "");
              await sleep(waitTime);
              continue;
            }
          }
          throw err;
        }
      }
    };

    // Run (use filtered keys)
    const keys = filteredKeys;
    const total = keys.length;
    let done = 0;
    let translated = 0;
    let skipped = 0;

    for (const k of keys) {
      if (cancelled) {
        updateProgress(done, total, "Cancelled by user.");
        break;
      }

      const srcText = (proj.entries[k][src] || "").trim();
      const tgtText = (proj.entries[k][tgt] || "").trim();

      if (!srcText) {
        done++;
        skipped++;
        updateProgress(done, total, `Skipped (no source): ${skipped} | Translated: ${translated}`, k);
        continue;
      }
      // If already has translation, skip (keep user edits)
      if (tgtText) {
        done++;
        skipped++;
        updateProgress(done, total, `Skipped (already translated): ${skipped} | Translated: ${translated}`, k);
        continue;
      }

      updateProgress(done, total, `Translating... | Translated: ${translated} | Skipped: ${skipped}`, k);

      try {
        const out = await translateWithRetry({
          sourceText: srcText,
          sourceLang: src,
          targetLang: tgt,
          maxChars,
          key: k
        });
        proj.entries[k][tgt] = out;
        proj.meta.updatedAt = Date.now();
        saveState();
        translated++;
      } catch (err) {
        console.error(err);
        updateProgress(done, total, `Error: ${err.message || String(err)}`, k);
        // Setup close button for error state
        const errCloseBtn = $("#modalCancel");
        errCloseBtn.textContent = "Close";
        errCloseBtn.disabled = false;
        errCloseBtn.onclick = () => {
          back.style.display = "none";
          $("#modalOK").style.display = "";
        };
        toast("Translation stopped", `${translated} translated before error`);
        renderList();
        return;
      }
      done++;
      updateProgress(done, total, `Translating... | Translated: ${translated} | Skipped: ${skipped}`, k);
    }

    // Done
    if (!cancelled) {
      updateProgress(total, total, `Done! Translated: ${translated} | Skipped: ${skipped}`, "");
      toast("Bulk translate complete", `${translated} translated, ${skipped} skipped`);
    } else {
      toast("Bulk translate cancelled", `${translated} translated before cancel`);
    }

    // Setup close button using onclick (not addEventListener to avoid stacking)
    const closeBtn = $("#modalCancel");
    closeBtn.textContent = "Close";
    closeBtn.disabled = false;
    closeBtn.onclick = () => {
      back.style.display = "none";
      $("#modalOK").style.display = ""; // Reset OK button
    };

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
          <button class="btn primary" id="btnSaveAllTop">Save</button>
          <button class="btn" id="btnBack" type="button">Back</button>
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

  // save all textareas into entry (both top and bottom buttons)
  const handleSave = () => {
    const tas = $$("textarea[data-lang]");
    for (const ta of tas) {
      const lang = ta.getAttribute("data-lang");
      entry[lang] = ta.value;
    }
    p.meta.updatedAt = Date.now();
    saveState();
    toast("Saved", key);
    setDirty(false);
    // Auto back to list after save
    location.hash = "#list";
  };
  $("#btnSaveAll").addEventListener("click", handleSave);
  $("#btnSaveAllTop").addEventListener("click", handleSave);

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
              <select id="setModel">
                <optgroup label="GPT-4o">
                  <option value="gpt-4o" ${s.openaiModel === "gpt-4o" ? "selected" : ""}>gpt-4o (flagship)</option>
                  <option value="gpt-4o-mini" ${(s.openaiModel === "gpt-4o-mini" || s.openaiModel === "gpt-4.1-mini" || !s.openaiModel) ? "selected" : ""}>gpt-4o-mini (fast, cheap)</option>
                </optgroup>
                <optgroup label="GPT-4">
                  <option value="gpt-4-turbo" ${s.openaiModel === "gpt-4-turbo" ? "selected" : ""}>gpt-4-turbo</option>
                  <option value="gpt-4" ${s.openaiModel === "gpt-4" ? "selected" : ""}>gpt-4</option>
                </optgroup>
                <optgroup label="GPT-3.5">
                  <option value="gpt-3.5-turbo" ${s.openaiModel === "gpt-3.5-turbo" ? "selected" : ""}>gpt-3.5-turbo</option>
                </optgroup>
                <optgroup label="Reasoning (o-series)">
                  <option value="o1" ${s.openaiModel === "o1" ? "selected" : ""}>o1</option>
                  <option value="o1-mini" ${s.openaiModel === "o1-mini" ? "selected" : ""}>o1-mini</option>
                  <option value="o1-preview" ${s.openaiModel === "o1-preview" ? "selected" : ""}>o1-preview</option>
                  <option value="o3-mini" ${s.openaiModel === "o3-mini" ? "selected" : ""}>o3-mini</option>
                </optgroup>
              </select>
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

        <div style="margin-top:16px; padding-top:12px; border-top:1px solid var(--border);">
          <div class="row">
            <div style="flex:1;">
              <label>Rename language</label>
              <div class="hint">Rename a language code and update all translations.</div>
            </div>
            <div style="width:140px;">
              <select id="setRenameLangFrom" ${projectLangs.length ? "" : "disabled"}>
                ${projectLangs.length
                  ? projectLangs.map(l => `<option value="${escapeAttr(l)}">${escapeHtml(l.toUpperCase())}</option>`).join("")
                  : `<option value="" selected>No languages</option>`
                }
              </select>
            </div>
            <div style="width:20px; text-align:center; color:var(--muted);">→</div>
            <div style="width:140px;">
              <input id="setRenameLangTo" placeholder="e.g. en-us" ${projectLangs.length ? "" : "disabled"} />
            </div>
            <button class="btn" id="btnRenameLang" ${projectLangs.length ? "" : "disabled"}>Rename</button>
          </div>
        </div>

        <div style="margin-top:12px;">
          <div class="row">
            <div style="flex:1;">
              <label>Delete language from project</label>
              <div class="hint">Removes a language from ALL keys in the current project (cannot be undone).</div>
            </div>
            <div style="width:200px;">
              <select id="setDelLang" ${projectLangs.length > 1 ? "" : "disabled"}>
                ${projectLangs.length > 1
                  ? projectLangs.map(l => `<option value="${escapeAttr(l)}">${escapeHtml(l.toUpperCase())}</option>`).join("")
                  : `<option value="" selected>Need 2+ languages</option>`
                }
              </select>
            </div>
            <button class="btn danger" id="btnDelLangSettings" ${projectLangs.length > 1 ? "" : "disabled"}>Delete</button>
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
    state.settings.openaiModel = $("#setModel").value || "gpt-4o-mini";
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

  // Rename language
  const btnRenameLang = $("#btnRenameLang");
  if (btnRenameLang) {
    btnRenameLang.addEventListener("click", async () => {
      const proj = currentProject();
      if (!proj) return toast("No project selected.");
      const fromLang = normalizeLangCode($("#setRenameLangFrom")?.value || "");
      const toLang = normalizeLangCode($("#setRenameLangTo")?.value || "");
      if (!fromLang) return toast("Select a language to rename.");
      if (!toLang) return toast("Enter a new language code.");
      if (fromLang === toLang) return toast("New code is same as current.");
      if (proj.languages.includes(toLang)) return toast(`Language "${toLang.toUpperCase()}" already exists.`);

      const keyCount = Object.keys(proj.entries).length;
      const ok = await confirmIfNeeded(
        `Rename "${fromLang.toUpperCase()}" to "${toLang.toUpperCase()}"? This will update ${keyCount} key(s).`,
        false
      );
      if (!ok) return;

      // Update all entries
      for (const key of Object.keys(proj.entries)) {
        if (proj.entries[key][fromLang] !== undefined) {
          proj.entries[key][toLang] = proj.entries[key][fromLang];
          delete proj.entries[key][fromLang];
        }
      }

      // Update languages array
      const idx = proj.languages.indexOf(fromLang);
      if (idx !== -1) proj.languages[idx] = toLang;

      // Update visible langs if needed
      const visIdx = state.ui.visibleLangs.indexOf(fromLang);
      if (visIdx !== -1) state.ui.visibleLangs[visIdx] = toLang;

      // Update default source lang if needed
      if (state.settings.defaultSourceLang === fromLang) {
        state.settings.defaultSourceLang = toLang;
      }

      proj.meta.updatedAt = Date.now();
      saveState();
      toast("Language renamed", `${fromLang.toUpperCase()} → ${toLang.toUpperCase()}`);
      renderSettings();
    });
  }

  // Delete language from settings
  const btnDelLangSettings = $("#btnDelLangSettings");
  if (btnDelLangSettings) {
    btnDelLangSettings.addEventListener("click", async () => {
      const proj = currentProject();
      if (!proj) return toast("No project selected.");
      if (proj.languages.length <= 1) return toast("Project must have at least 1 language.");
      const lang = normalizeLangCode($("#setDelLang")?.value || "");
      if (!lang) return toast("Select a language.");
      const ok = await confirmIfNeeded(`Delete language "${lang.toUpperCase()}" from all keys? This cannot be undone.`, true);
      if (!ok) return;
      await deleteLanguageFromProject(proj, lang);
      renderSettings();
    });
  }
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
