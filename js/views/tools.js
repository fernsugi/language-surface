/* Language Surface — task dialogs: languages, find & replace, clear, new project, shortcuts. */
(function (LS) {
  "use strict";

  const h = LS.h;
  const icon = LS.icon;
  const { store, util, ui, langs } = LS;

  /* ---- Languages ---------------------------------------------------------------------- */

  /** Open the language picker and add the chosen language to the current project. */
  function addLanguage(anchor, opts) {
    const p = store.project();
    if (!p) return null;
    return LS.pickers.language(
      anchor,
      Object.assign({}, opts, {
        exclude: p.languages,
        onPick: (code) => {
          const res = store.addLanguage(code);
          if (!res.ok) return LS.toast(res.error, { type: "error" });
          LS.toast(langs.displayName(res.code) + " added", {
            type: "success",
            description: "Empty for now — translate it by hand or with AI.",
            action: LS.ai.configProblem(store.state.settings.ai) ? null : { label: "Translate", onClick: () => LS.app.actions.translate({ targets: [res.code] }) },
          });
        },
      })
    );
  }

  async function renameLanguage(lang) {
    const p = store.project();
    if (!p) return;
    const next = await LS.dialog.prompt({
      title: "Rename " + langs.label(lang),
      description: "Changes the language code everywhere in this project. Translations are kept.",
      label: "New code",
      value: lang,
      mono: true,
      confirmLabel: "Rename",
      hint: "Examples: en-us, pt-br, zh-hans",
      validate: (v) => {
        const code = langs.normalize(v);
        if (!code) return "Enter a language code.";
        if (code !== lang && p.languages.includes(code)) return langs.label(code) + " already exists in this project.";
        return "";
      },
    });
    if (next == null) return;
    const res = store.renameLanguage(lang, next);
    if (!res.ok) LS.toast(res.error, { type: "error" });
    else if (!res.unchanged) LS.toast("Language renamed", { description: langs.label(lang) + " → " + langs.label(res.code), action: LS.app.actions.undoAction() });
  }

  async function removeLanguage(lang) {
    const p = store.project();
    if (!p) return;
    const filled = store.stats(p).filled[lang] || 0;
    const ok = await LS.dialog.confirm({
      title: "Remove " + langs.displayName(lang) + "?",
      message: filled ? util.plural(filled, "translation") + " in " + langs.label(lang) + " will be removed from this project." : langs.label(lang) + " has no translations yet.",
      confirmLabel: "Remove language",
      danger: true,
    });
    if (!ok) return;
    const res = store.removeLanguage(lang);
    if (!res.ok) LS.toast(res.error, { type: "error" });
    else LS.toast(langs.displayName(lang) + " removed", { action: LS.app.actions.undoAction() });
  }

  /** Empty every translation of one language within `keys`. */
  async function clearLanguage(lang, keys, filtered) {
    const p = store.project();
    if (!p) return;
    const targets = keys.filter((k) => store.getValue(k, lang, p) !== "");
    if (!targets.length) return LS.toast("Nothing to clear", { description: langs.label(lang) + " is already empty " + (filtered ? "in this view." : "everywhere.") });
    const ok = await LS.dialog.confirm({
      title: "Clear " + langs.displayName(lang) + " translations?",
      message: util.plural(targets.length, "translation") + " will be emptied" + (filtered ? " in the keys currently listed." : " across the whole project.") + " Keys stay in place.",
      confirmLabel: "Clear " + util.formatNumber(targets.length),
      danger: true,
    });
    if (!ok) return;
    store.setValues(targets.map((key) => ({ key, lang, value: "" })), "Clear " + langs.label(lang));
    LS.toast(util.plural(targets.length, "translation") + " cleared", { action: LS.app.actions.undoAction() });
  }

  /* ---- Find & replace ---------------------------------------------------------------------- */

  /**
   * @param {string} [initialLang]
   * @param {{keys: string[], filtered: boolean}} [scope] keys of the current view; used as the default scope when filtered
   */
  function findReplace(initialLang, scope) {
    const p = store.project();
    if (!p) return;
    const v = store.view();
    const visible = p.languages.filter((l) => v.visibleLangs.includes(l));
    const scoped = scope && scope.filtered && scope.keys.length ? scope.keys : null;
    const state = { lang: initialLang && p.languages.includes(initialLang) ? initialLang : "*", find: "", replace: "", matchCase: true, scope: scoped ? "view" : "all" };
    const keysOf = () => (state.scope === "view" && scoped ? scoped.filter((k) => store.hasKey(k, p)) : Object.keys(p.entries));
    let matches = [];

    const findInput = h("input.input", { type: "text", placeholder: "Text to find", autocomplete: "off", spellcheck: false, attrs: { autofocus: true } });
    const replaceInput = h("input.input", { type: "text", placeholder: "Leave empty to delete the matches", autocomplete: "off", spellcheck: false });
    const langSelect = ui.select({
      value: state.lang,
      options: [{ value: "*", label: "Visible languages (" + visible.length + ")" }].concat(p.languages.map((l) => ({ value: l, label: langs.displayName(l) + " (" + langs.label(l) + ")" }))),
      onChange: (val) => {
        state.lang = val;
        refresh();
      },
    });
    const total = Object.keys(p.entries).length;
    const scopeSelect = ui.select({
      value: state.scope,
      options: [{ value: "all", label: "All keys (" + util.formatNumber(total) + ")" }].concat(scoped ? [{ value: "view", label: "Keys in the current view (" + util.formatNumber(scoped.length) + ")" }] : []),
      onChange: (val) => {
        state.scope = val;
        refresh();
      },
    });
    const caseBox = ui.checkbox({
      checked: state.matchCase,
      label: "Match case",
      onChange: (on) => {
        state.matchCase = on;
        refresh();
      },
    });
    const summary = h("div.summary");
    const preview = h("div.diff-list", { hidden: true });
    const applyBtn = ui.button({ label: "Replace all", variant: "primary", type: "submit", disabled: true });

    function scan() {
      matches = [];
      let occurrences = 0;
      if (!state.find) return 0;
      const finder = LS.text.finder(state.find, { matchCase: state.matchCase });
      const targets = state.lang === "*" ? visible : [state.lang];
      for (const key of keysOf()) {
        for (const lang of targets) {
          const value = store.getValue(key, lang, p);
          if (!value) continue;
          const n = finder.count(value);
          if (!n) continue;
          occurrences += n;
          matches.push({ key, lang, value, next: finder.replace(value, state.replace), pieces: finder.pieces(value) });
        }
      }
      return occurrences;
    }

    function refresh() {
      state.find = findInput.value;
      state.replace = replaceInput.value;
      const occurrences = scan();
      applyBtn.disabled = !matches.length;
      const label = applyBtn.querySelector(".btn-label");
      label.textContent = matches.length ? "Replace " + util.formatNumber(occurrences) : "Replace all";
      if (!state.find) {
        LS.dom.replaceChildren(summary, h("span", "Type something to find. Matches are previewed before anything changes."));
        preview.hidden = true;
        return;
      }
      if (!matches.length) {
        LS.dom.replaceChildren(summary, h("span", icon("search-x", { size: 14 }), "No matches."));
        preview.hidden = true;
        return;
      }
      const keyCount = new Set(matches.map((m) => m.key)).size;
      LS.dom.replaceChildren(summary, h("span", h("b", util.formatNumber(occurrences)), occurrences === 1 ? "match" : "matches"), h("span", "in", h("b", util.formatNumber(keyCount)), keyCount === 1 ? "key" : "keys"));
      LS.dom.clear(preview);
      for (const m of matches.slice(0, 40)) {
        const text = h("div.diff-text");
        m.pieces.forEach((piece, i) => {
          if (!piece) return;
          if (i % 2) {
            text.appendChild(h("del", piece));
            if (state.replace) text.appendChild(h("ins", state.replace));
          } else text.appendChild(document.createTextNode(piece));
        });
        preview.appendChild(h("div.diff-row", h("div.diff-key", m.key + " · " + langs.label(m.lang)), text));
      }
      if (matches.length > 40) preview.appendChild(h("div.diff-more", "…and " + util.formatNumber(matches.length - 40) + " more"));
      preview.hidden = false;
    }

    findInput.addEventListener("input", refresh);
    replaceInput.addEventListener("input", refresh);

    const dlg = LS.dialog.open({
      title: "Find and replace",
      description: "Nothing changes until you confirm. The whole replacement is one undo step.",
      size: "lg",
      form: true,
      body: [
        h("div.form-grid", ui.field({ label: "Find", control: findInput }), ui.field({ label: "Replace with", control: replaceInput })),
        h("div.form-grid", ui.field({ label: "Languages", control: langSelect }), ui.field({ label: "Keys", control: scopeSelect })),
        caseBox,
        summary,
        preview,
      ],
      footer: [ui.button({ label: "Cancel", onClick: () => dlg.close(null) }), applyBtn],
    });
    dlg.panel.addEventListener("submit", (e) => {
      e.preventDefault();
      refresh();
      if (!matches.length) return;
      const changes = matches.map((m) => ({ key: m.key, lang: m.lang, value: m.next }));
      store.setValues(changes, "Replace “" + state.find + "”");
      dlg.close(true);
      LS.toast(util.plural(changes.length, "translation") + " updated", { type: "success", action: LS.app.actions.undoAction() });
    });
    refresh();
  }

  /* ---- New project ---------------------------------------------------------------------- */

  function newProject() {
    const nameInput = h("input.input", { type: "text", placeholder: "e.g. Mobile app", autocomplete: "off", attrs: { autofocus: true } });
    let source = "en";
    const langBtn = h("button.btn", { type: "button", style: "justify-content:flex-start;width:100%" });
    const renderLang = () => LS.dom.replaceChildren(langBtn, ui.langTag(source, { source: true }), h("span.btn-label.grow", { style: "text-align:left" }, langs.displayName(source)), icon("chevrons-up-down", { size: 13 }));
    langBtn.addEventListener("click", () =>
      LS.overlay.toggle(langBtn, () =>
        LS.pickers.language(langBtn, {
          onPick: (code) => {
            source = code;
            renderLang();
          },
        })
      )
    );
    renderLang();
    const nameField = ui.field({ label: "Name", control: nameInput });
    const dlg = LS.dialog.open({
      title: "New project",
      description: "A project is a set of keys translated into one or more languages.",
      size: "sm",
      form: true,
      body: [nameField, ui.field({ label: "Source language", control: langBtn, hint: "The language you write first. You can add the others afterwards." })],
      footer: [ui.button({ label: "Cancel", onClick: () => dlg.close(null) }), ui.button({ label: "Create project", variant: "primary", type: "submit" })],
    });
    dlg.panel.addEventListener("submit", (e) => {
      e.preventDefault();
      const p = store.createProject({ name: nameInput.value, languages: [source], sourceLang: source });
      store.setUI({ seenWelcome: true });
      dlg.close(true);
      LS.app.navigate("translations");
      LS.toast("Project created", { type: "success", description: p.name });
    });
  }

  /* ---- Shortcuts ---------------------------------------------------------------------- */

  const SHORTCUTS = [
    { group: "Everywhere" },
    { keys: ["mod+K"], label: "Search keys and commands" },
    { keys: ["mod+Z"], label: "Undo" },
    { keys: ["shift+mod+Z"], label: "Redo" },
    { keys: ["mod+B"], label: "Show or hide the sidebar" },
    { keys: ["?"], label: "Show this list" },
    { group: "Translations" },
    { keys: ["/"], label: "Filter keys and text" },
    { keys: ["N"], label: "Add a key" },
    { keys: ["mod+I"], label: "Show or hide details" },
    { keys: ["up", "down", "left", "right"], label: "Move between cells" },
    { keys: ["enter"], label: "Edit the cell" },
    { keys: ["Space"], label: "Select the row" },
    { keys: ["P"], label: "Pin or unpin the row" },
    { keys: ["mod+C"], label: "Copy the cell or key" },
    { keys: ["mod+enter"], label: "Translate the cell with AI" },
    { keys: ["backspace"], label: "Clear the cell" },
    { group: "While editing a cell" },
    { keys: ["enter"], label: "Save and edit the next row" },
    { keys: ["Tab"], label: "Save and edit the next cell" },
    { keys: ["shift+enter"], label: "Insert a line break" },
    { keys: ["esc"], label: "Discard the change" },
  ];

  function shortcutList() {
    return h(
      "div.shortcut-list",
      SHORTCUTS.map((s) => (s.group ? h("div.shortcut-group", s.group) : h("div.shortcut", h("span", s.label), h("span.shortcut-keys", s.keys.map((k) => ui.kbd(k))))))
    );
  }

  function shortcuts() {
    const dlg = LS.dialog.open({ title: "Keyboard shortcuts", size: "lg", body: shortcutList(), footer: [ui.button({ label: "Done", variant: "primary", attrs: { autofocus: true }, onClick: () => dlg.close(null) })] });
  }

  LS.tools = { addLanguage, renameLanguage, removeLanguage, clearLanguage, findReplace, newProject, shortcuts, shortcutList };
})(globalThis.LS || (globalThis.LS = {}));
