/* Language Surface — Translations view: toolbar, grid, inspector and row actions. */
(function (LS) {
  "use strict";

  const h = LS.h;
  const icon = LS.icon;
  const { store, util, ui, overlay, langs } = LS;
  const KEY_COL = "@key";
  const WIDE = 1180;

  function mount(container, params) {
    const sc = LS.shell.scope();
    const actions = LS.app.actions;
    let rows = [];
    let pinnedCount = 0;
    let counts = { total: 0, missing: 0, issues: null, pinned: 0 };
    let sortedKeys = null; // cache of all keys in natural order, rebuilt after structural changes
    let issuesCache = { rev: -1, map: new Map() };
    let inspectorOpen = store.state.ui.inspectorOpen && window.innerWidth > WIDE;
    let issueTimer = 0;

    /* ---- Derived data ---------------------------------------------------------------- */

    function getIssues(key, lang) {
      const p = store.project();
      if (!p || lang === p.sourceLang) return null;
      const rev = store.rev(p.id);
      if (issuesCache.rev !== rev || issuesCache.project !== p.id) issuesCache = { rev, project: p.id, map: new Map() };
      const id = key + "\u0000" + lang;
      let res = issuesCache.map.get(id);
      if (res === undefined) {
        const target = store.getValue(key, lang, p);
        res = target ? LS.text.checkTranslation(store.getValue(key, p.sourceLang, p), target) : [];
        issuesCache.map.set(id, res);
      }
      return res;
    }

    function keyHasIssues(key, visible) {
      for (const l of visible) {
        const res = getIssues(key, l);
        if (res && res.length) return true;
      }
      return false;
    }

    function getFinder() {
      const v = store.view();
      const q = v.search.trim();
      if (!q) return null;
      const f = LS.text.finder(q, { matchCase: false });
      return { keys: v.searchIn !== "text" ? f : null, text: v.searchIn !== "keys" ? f : null };
    }

    function computeRows() {
      const p = store.project();
      const v = store.view();
      const visible = p.languages.filter((l) => v.visibleLangs.includes(l));
      const entries = p.entries;
      if (!sortedKeys) sortedKeys = Object.keys(entries).sort(util.natCompare);
      const ns = v.namespace;
      const q = v.search.trim().toLowerCase();
      const inKeys = v.searchIn !== "text";
      const inText = v.searchIn !== "keys";
      const pinnedSet = new Set(p.pinned);
      const status = v.status;
      let total = 0;
      let missing = 0;
      const list = [];

      for (let i = 0; i < sortedKeys.length; i++) {
        const key = sortedKeys[i];
        if (ns && !LS.keys.inNamespace(key, ns)) continue;
        const entry = entries[key];
        if (!entry) continue;
        total++;
        let isMissing = false;
        for (let j = 0; j < visible.length; j++) {
          const val = entry[visible[j]];
          if (typeof val !== "string" || val === "") {
            isMissing = true;
            break;
          }
        }
        if (isMissing) missing++;
        const isPinned = pinnedSet.has(key);
        if (status === "pinned") {
          if (!isPinned) continue;
        } else {
          if (isPinned) continue; // pinned rows are listed separately, on top
          if (status === "missing" && !isMissing) continue;
          if (status === "issues" && !keyHasIssues(key, visible)) continue;
        }
        if (q) {
          let hit = inKeys && key.toLowerCase().includes(q);
          if (!hit && inText) {
            for (let j = 0; j < visible.length; j++) {
              const val = entry[visible[j]];
              if (typeof val === "string" && val.toLowerCase().includes(q)) {
                hit = true;
                break;
              }
            }
          }
          if (!hit) continue;
        }
        list.push(key);
      }

      if (v.sortBy === "key") {
        if (v.sortDir === "desc") list.reverse();
      } else {
        const lang = v.sortBy.slice(5);
        const dir = v.sortDir === "desc" ? -1 : 1;
        const val = (k) => {
          const x = entries[k][lang];
          return typeof x === "string" ? x : "";
        };
        list.sort((a, b) => {
          const av = val(a);
          const bv = val(b);
          if (!av !== !bv) return av ? -1 : 1; // empty values last, whatever the direction
          return dir * util.textCompare(av, bv) || util.natCompare(a, b);
        });
      }

      const pinnedRows = status === "pinned" ? [] : p.pinned.filter((k) => store.hasKey(k, p));
      rows = pinnedRows.concat(list);
      pinnedCount = pinnedRows.length;
      counts = { total, missing, issues: counts.issues, pinned: p.pinned.length };
    }

    function countIssuesSoon() {
      clearTimeout(issueTimer);
      issueTimer = setTimeout(() => {
        const p = store.project();
        if (!p) return;
        const v = store.view();
        const visible = p.languages.filter((l) => v.visibleLangs.includes(l));
        let n = 0;
        for (const key in p.entries) {
          if (v.namespace && !LS.keys.inNamespace(key, v.namespace)) continue;
          if (keyHasIssues(key, visible)) n++;
        }
        counts.issues = n;
        syncStatusTabs();
      }, 160);
    }

    /* ---- Top bar ---------------------------------------------------------------------- */

    const p0 = store.project();
    const titleInput = h("input.title-edit", { type: "text", value: p0.name, spellcheck: false, autocomplete: "off", "aria-label": "Project name", "data-tip": "Rename project" });
    // Size the field to its text (measured, so it works in every browser and for any script).
    let measure = null;
    const fitTitle = () => {
      if (!titleInput.isConnected) return;
      const cs = getComputedStyle(titleInput);
      measure = measure || document.createElement("canvas").getContext("2d");
      measure.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
      titleInput.style.width = Math.ceil(measure.measureText(titleInput.value || " ").width) + 18 + "px";
    };
    const commitTitle = () => {
      const p = store.project();
      if (!p || !sc.alive()) return;
      const next = titleInput.value.trim();
      if (!next) titleInput.value = p.name;
      else if (next !== p.name) store.renameProject(next);
      else titleInput.value = p.name;
      fitTitle();
    };
    titleInput.addEventListener("blur", commitTitle);
    titleInput.addEventListener("input", fitTitle);
    titleInput.addEventListener("keydown", (e) => {
      if (LS.dom.isIME(e)) return;
      if (e.key === "Enter") {
        e.preventDefault();
        titleInput.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        titleInput.value = store.project().name;
        titleInput.blur();
      }
    });

    const projectMenuBtn = ui.button({
      icon: "ellipsis",
      variant: "ghost",
      tip: "Project actions",
      onClick: (e) =>
        overlay.toggle(e.currentTarget, () =>
          overlay.menu(e.currentTarget, [
            { label: "Rename", icon: "pencil", onSelect: () => titleInput.focus() },
            { label: "Duplicate project", icon: "copy-plus", onSelect: () => actions.duplicateProject() },
            { label: "Manage languages", icon: "globe", onSelect: () => LS.app.navigate("languages") },
            { separator: true },
            { label: "Delete project…", icon: "trash-2", danger: true, onSelect: () => actions.deleteProject() },
          ])
        ),
    });

    const topbar = LS.shell.topbar(
      {
        title: [titleInput, projectMenuBtn],
        actions: [
          ui.button({ label: "Import", icon: "upload", class: "collapse-narrow", onClick: () => actions.importFiles() }),
          ui.button({ label: "Export", icon: "download", class: "collapse-narrow", onClick: () => actions.exportProject({ keys: scopeKeys() }) }),
          ui.button({ label: "Translate", icon: "sparkles", variant: "accent", class: "collapse-narrow", onClick: () => actions.translate(translateScope()) }),
        ],
      },
      sc
    );

    /* ---- Toolbar ---------------------------------------------------------------------- */

    const searchInput = h("input.input", { type: "search", placeholder: "Filter keys and text", autocomplete: "off", spellcheck: false, "aria-label": "Filter keys and text", value: store.view().search });
    const clearSearch = h("button.input-clear", { type: "button", "aria-label": "Clear filter", hidden: true, onClick: () => setSearch("") }, icon("x", { size: 13 }));
    const SEARCH_SCOPES = { all: "All", keys: "Keys", text: "Text" };
    const scopeBtn = h("button.btn.ghost.sm.search-scope", {
      type: "button",
      "data-tip": "Where to search",
      "aria-haspopup": "menu",
      onClick: (e) =>
        overlay.toggle(e.currentTarget, () =>
          overlay.menu(
            e.currentTarget,
            [
              { heading: "Search in" },
              { label: "Keys and text", checked: store.view().searchIn === "all", onSelect: () => store.setView({ searchIn: "all" }) },
              { label: "Keys only", checked: store.view().searchIn === "keys", onSelect: () => store.setView({ searchIn: "keys" }) },
              { label: "Text only", checked: store.view().searchIn === "text", onSelect: () => store.setView({ searchIn: "text" }) },
            ],
            { placement: "bottom-end" }
          )
        ),
    });
    const applySearch = util.debounce(() => store.setView({ search: searchInput.value }), 90);
    function setSearch(value) {
      searchInput.value = value;
      applySearch.cancel();
      store.setView({ search: value });
      searchInput.focus();
    }
    searchInput.addEventListener("input", () => {
      clearSearch.hidden = !searchInput.value;
      applySearch();
    });
    searchInput.addEventListener("keydown", (e) => {
      if (LS.dom.isIME(e)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (searchInput.value) setSearch("");
        else grid.focus();
      } else if (e.key === "ArrowDown" || e.key === "Enter") {
        e.preventDefault();
        applySearch.flush();
        if (rows.length) {
          grid.focus();
          const a = grid.getActive();
          if (!a.key) grid.setActive(rows[0], grid.getColumns()[0] || KEY_COL);
        }
      }
    });

    const statusTabs = ui.segmented({
      ariaLabel: "Filter by status",
      value: store.view().status,
      options: statusOptions(),
      onChange: (value) => store.setView({ status: value }),
    });

    function statusOptions() {
      return [
        { value: "all", label: "All", count: util.formatNumber(counts.total) },
        { value: "missing", label: "Missing", count: util.formatNumber(counts.missing), tip: "Keys with an empty translation in a visible language" },
        { value: "issues", label: "Issues", count: counts.issues == null ? "–" : util.formatNumber(counts.issues), tip: "Placeholder or spacing mismatches against the source text" },
        { value: "pinned", label: "Pinned", count: util.formatNumber(counts.pinned) },
      ];
    }
    function syncStatusTabs() {
      statusTabs.setOptions(statusOptions());
      statusTabs.setValue(store.view().status);
    }

    const nsChipSlot = h("span", { style: "display:contents" });
    function syncNsChip() {
      const ns = store.view().namespace;
      LS.dom.clear(nsChipSlot);
      if (!ns) return;
      nsChipSlot.appendChild(
        h(
          "span.ns-chip",
          { title: "Showing keys in " + ns },
          icon("list-tree", { size: 13 }),
          h("span.mono", ns),
          h("button", { type: "button", "aria-label": "Show all namespaces", onClick: () => store.setView({ namespace: "" }) }, icon("x", { size: 12 }))
        )
      );
    }

    const columnsBtn = ui.button({ label: "Languages", icon: "columns-3", class: "collapse-cq tb-columns", tip: "Choose visible languages", onClick: (e) => overlay.toggle(e.currentTarget, () => LS.pickers.columns(e.currentTarget)) });
    const columnsLabel = columnsBtn.querySelector(".btn-label");
    function syncColumnsBtn() {
      const p = store.project();
      const v = store.view();
      columnsLabel.textContent = v.visibleLangs.length === p.languages.length ? "Languages" : "Languages " + v.visibleLangs.length + "/" + p.languages.length;
    }

    const DENSITIES = [
      { value: "compact", label: "Compact", icon: "rows-4", hint: "One line per row" },
      { value: "comfortable", label: "Comfortable", icon: "rows-3", hint: "Up to two lines" },
      { value: "tall", label: "Tall", icon: "rows-2", hint: "Up to four lines" },
    ];
    const viewMenuBtn = ui.button({
      icon: "sliders-horizontal",
      class: "tb-view",
      tip: "View and bulk tools",
      onClick: (e) =>
        overlay.toggle(e.currentTarget, () => {
          const density = store.state.settings.density;
          const v = store.view();
          return overlay.menu(
            e.currentTarget,
            [
              { heading: "Row height" },
              ...DENSITIES.map((d) => ({ label: d.label, icon: d.icon, checked: density === d.value, onSelect: () => store.setSetting("density", d.value) })),
              { separator: true },
              { heading: "Tools" },
              { label: "Find and replace…", icon: "replace", onSelect: () => actions.findReplace() },
              { label: "Export this view…", icon: "download", disabled: !rows.length, onSelect: () => actions.exportProject({ keys: rows.slice(), scoped: true }) },
              { separator: true },
              { label: "Reset filters", icon: "rotate-ccw", disabled: !(v.search || v.namespace || v.status !== "all"), onSelect: () => resetFilters() },
            ],
            { placement: "bottom-end" }
          );
        }),
    });

    const inspectorBtn = ui.button({ icon: "panel-right", class: "tb-inspector", tip: "Details panel", tipKbd: "mod+I", onClick: () => setInspector(!inspectorOpen) });
    const addKeyBtn = ui.button({ label: "Add key", icon: "plus", variant: "primary", class: "collapse-phone tb-add", tip: "Add a new key", tipKbd: "N", onClick: () => openAddKey() });

    const toolbar = h(
      "div.toolbar",
      h("div.input-wrap.toolbar-search", icon("search", { size: 14 }), searchInput, h("span.input-trail", clearSearch, scopeBtn)),
      statusTabs,
      nsChipSlot,
      h("div.toolbar-end", columnsBtn, viewMenuBtn, inspectorBtn, addKeyBtn)
    );

    function syncScopeBtn() {
      scopeBtn.textContent = SEARCH_SCOPES[store.view().searchIn] || "All";
    }

    function resetFilters() {
      searchInput.value = "";
      clearSearch.hidden = true;
      store.setView({ search: "", namespace: "", status: "all" });
    }

    /* ---- Grid -------------------------------------------------------------------------- */

    const grid = LS.createGrid({
      getIssues,
      getFinder,
      isBusy: (key, lang) => LS.translator.isBusy(key, lang),
      onCommit: (key, lang, value) => {
        if (sc.alive()) store.setValue(key, lang, value);
      },
      onActiveChange: (a) => {
        if (inspectorOpen) inspector.show(a.key);
        syncStatus();
      },
      onOpenKey: (key, focusKey) => {
        setInspector(true);
        inspector.show(key);
        if (focusKey) inspector.focusField(store.project().sourceLang);
      },
      onRowMenu: (anchorOrEvent, key, lang) => openRowMenu(anchorOrEvent, key, lang),
      onHeaderMenu: (anchor, lang) => overlay.toggle(anchor, () => openHeaderMenu(anchor, lang)),
      onAddLanguage: (anchor) => overlay.toggle(anchor, () => LS.tools.addLanguage(anchor, { placement: "bottom-end" })),
      onSelectionChange: () => syncBulkBar(),
      onTogglePin: (key) => togglePin([key]),
      onDeleteKeys: (keys) => deleteKeys(keys),
      onCopy: (text, what) => copy(text, what === "key" ? "Key copied" : "Text copied"),
      onTranslateCell: (key, lang) => translateCells([key], [lang]),
    });

    /* ---- Inspector ----------------------------------------------------------------------- */

    const inspector = LS.createInspector({
      isAlive: () => sc.alive(),
      onClose: () => setInspector(false),
      onFocusGrid: () => grid.focus(),
      onNavigate: (delta, lang) => {
        const a = grid.getActive();
        const i = rows.indexOf(inspector.key != null ? inspector.key : a.key);
        const next = rows[i + delta];
        if (next == null) return;
        grid.setActive(next, a.col || KEY_COL);
        inspector.show(next);
        if (lang) inspector.focusField(lang);
      },
      onRenamed: (oldKey, newKey) => {
        grid.setActive(newKey, grid.getActive().col || KEY_COL, { silent: true });
        inspector.show(newKey);
      },
      onDelete: (key) => deleteKeys([key]),
      onDuplicate: (key) => duplicateKey(key),
      onTranslate: (key, targets) => translateCells([key], targets),
      getPosition: (key) => {
        const i = rows.indexOf(key);
        return i === -1 ? null : { index: i, total: rows.length };
      },
    });
    inspector.el.hidden = !inspectorOpen;

    function setInspector(open) {
      inspectorOpen = !!open;
      inspector.el.hidden = !inspectorOpen;
      inspectorBtn.setAttribute("aria-pressed", String(inspectorOpen));
      inspectorBtn.classList.toggle("active", inspectorOpen);
      if (window.innerWidth > WIDE) store.setUI({ inspectorOpen });
      if (inspectorOpen) {
        // The panel is not kept in sync while hidden: rebuild it from the store.
        const activeKey = grid.getActive().key;
        if (inspector.key === activeKey) inspector.refresh();
        else inspector.show(activeKey);
      } else inspector.flush();
    }

    /* ---- Bulk bar & status bar ------------------------------------------------------------- */

    const bulkSlot = h("div", { style: "display:contents" });
    function syncBulkBar() {
      const sel = grid.getSelection();
      LS.dom.clear(bulkSlot);
      syncStatus();
      if (!sel.size) return;
      const keys = Array.from(sel);
      const p = store.project();
      const allPinned = keys.every((k) => p.pinned.includes(k));
      bulkSlot.appendChild(
        h(
          "div.bulkbar",
          { role: "toolbar", "aria-label": "Selected keys" },
          h("span.bulkbar-count", util.plural(keys.length, "key") + " selected"),
          ui.button({ label: "Translate", icon: "sparkles", onClick: () => actions.translate({ keys, scope: "selected" }) }),
          ui.button({ label: allPinned ? "Unpin" : "Pin", icon: allPinned ? "pin-off" : "pin", onClick: () => store.setPinned(keys, !allPinned) }),
          ui.button({ label: "Export", icon: "download", onClick: () => actions.exportProject({ keys, scoped: true }) }),
          ui.button({ label: "Delete", icon: "trash-2", variant: "danger", onClick: () => deleteKeys(keys) }),
          ui.button({ icon: "x", ariaLabel: "Clear selection", tip: "Clear selection", onClick: () => grid.clearSelection() })
        )
      );
    }

    const statusText = h("span");
    const statusbar = h(
      "div.statusbar",
      statusText,
      h(
        "div.statusbar-hints",
        h("span", ui.kbd("enter"), "edit"),
        h("span", ui.kbd("Tab"), "next cell"),
        h("span", ui.kbd("esc"), "cancel"),
        h("button.link-btn", { type: "button", onClick: () => actions.shortcuts() }, "All shortcuts")
      )
    );
    function syncStatus() {
      const p = store.project();
      if (!p) return;
      const total = store.stats(p).total;
      const shown = rows.length;
      let text = shown === total ? util.plural(total, "key") : util.formatNumber(shown) + " of " + util.plural(total, "key");
      const sel = grid.getSelection().size;
      if (sel) text += " · " + sel + " selected";
      statusText.textContent = text;
    }

    /* ---- Row actions ------------------------------------------------------------------------- */

    async function copy(text, message) {
      if (await LS.dom.copyText(text)) LS.toast(message || "Copied", { duration: 1400 });
      else LS.toast("Could not copy", { type: "error" });
    }

    function togglePin(keys) {
      const p = store.project();
      const allPinned = keys.every((k) => p.pinned.includes(k));
      store.setPinned(keys, !allPinned);
      LS.toast(allPinned ? "Unpinned" : "Pinned to the top", { description: keys.length === 1 ? keys[0] : util.plural(keys.length, "key"), duration: 1800 });
    }

    async function deleteKeys(keys) {
      if (!keys.length) return;
      const one = keys.length === 1;
      const ok = await actions.confirmDelete({
        title: one ? "Delete this key?" : "Delete " + util.plural(keys.length, "key") + "?",
        message: one ? "“" + keys[0] + "” and its translations in every language will be removed." : "The selected keys and their translations in every language will be removed.",
        confirmLabel: one ? "Delete key" : "Delete " + keys.length + " keys",
      });
      if (!ok) return;
      const n = store.deleteKeys(keys);
      if (n) LS.toast(one ? "Key deleted" : util.plural(n, "key") + " deleted", { description: one ? keys[0] : "", action: actions.undoAction() });
      grid.focus();
    }

    function duplicateKey(key) {
      const copyKey = store.duplicateKey(key);
      if (copyKey) {
        reveal(copyKey);
        setInspector(true);
        inspector.show(copyKey);
        inspector.focusKey();
      }
    }

    function translateCells(keys, targets) {
      LS.translator.translateCells(keys, targets);
    }

    function openRowMenu(anchorOrEvent, key, lang) {
      const p = store.project();
      const sel = grid.getSelection();
      const multi = sel.size > 1 && sel.has(key);
      const keys = multi ? Array.from(sel) : [key];
      const pinned = keys.every((k) => p.pinned.includes(k));
      const items = [];
      if (!multi) {
        items.push({ label: "Open details", icon: "panel-right", onSelect: () => grid.el.dispatchEvent(new CustomEvent("ls-open", { detail: key })) });
        if (lang) items.push({ label: "Edit " + langs.label(lang), icon: "pencil", kbd: "enter", onSelect: () => grid.startEdit(key, lang) });
        items.push({ separator: true });
        if (lang && lang !== p.sourceLang) items.push({ label: "Translate " + langs.label(lang) + " with AI", icon: "sparkles", kbd: "mod+enter", onSelect: () => translateCells([key], [lang]) });
        items.push({
          label: "Translate missing languages",
          icon: "wand-sparkles",
          onSelect: () => {
            const targets = p.languages.filter((l) => l !== p.sourceLang && !store.getValue(key, l));
            if (!targets.length) LS.toast("Nothing to translate", { description: "This key is translated in every language." });
            else translateCells([key], targets);
          },
        });
        items.push({ separator: true });
        items.push({ label: "Copy key", icon: "copy", onSelect: () => copy(key, "Key copied") });
        if (lang && store.getValue(key, lang)) items.push({ label: "Copy " + langs.label(lang) + " text", icon: "clipboard", kbd: "mod+C", onSelect: () => copy(store.getValue(key, lang), "Text copied") });
        items.push({ label: "Duplicate", icon: "copy-plus", onSelect: () => duplicateKey(key) });
        items.push({
          label: "Rename…",
          icon: "text-cursor-input",
          onSelect: () => {
            setInspector(true);
            inspector.show(key);
            inspector.focusKey();
          },
        });
      } else {
        items.push({ heading: util.plural(keys.length, "key") + " selected" });
        items.push({ label: "Translate with AI…", icon: "sparkles", onSelect: () => actions.translate({ keys, scope: "selected" }) });
        items.push({ label: "Export selection…", icon: "download", onSelect: () => actions.exportProject({ keys, scoped: true }) });
      }
      items.push({ label: pinned ? "Unpin" : "Pin to top", icon: pinned ? "pin-off" : "pin", kbd: multi ? null : "P", onSelect: () => store.setPinned(keys, !pinned) });
      items.push({ separator: true });
      items.push({ label: multi ? "Delete " + keys.length + " keys" : "Delete key", icon: "trash-2", danger: true, onSelect: () => deleteKeys(keys) });

      if (anchorOrEvent instanceof Event) overlay.contextMenu(anchorOrEvent, items);
      else overlay.toggle(anchorOrEvent, () => overlay.menu(anchorOrEvent, items, { placement: "bottom-start" }));
    }
    grid.el.addEventListener("ls-open", (e) => {
      setInspector(true);
      grid.setActive(e.detail, KEY_COL);
      inspector.show(e.detail);
    });

    function openHeaderMenu(anchor, lang) {
      const p = store.project();
      const v = store.view();
      const isSource = lang === p.sourceLang;
      const sortedBy = v.sortBy === "lang:" + lang ? v.sortDir : null;
      return overlay.menu(
        anchor,
        [
          { label: "Sort A → Z", icon: "arrow-down-a-z", checked: sortedBy === "asc", onSelect: () => store.setView({ sortBy: "lang:" + lang, sortDir: "asc" }) },
          { label: "Sort Z → A", icon: "arrow-down-z-a", checked: sortedBy === "desc", onSelect: () => store.setView({ sortBy: "lang:" + lang, sortDir: "desc" }) },
          { label: "Hide column", icon: "eye-off", disabled: v.visibleLangs.length <= 1, onSelect: () => store.setView({ visibleLangs: v.visibleLangs.filter((l) => l !== lang) }) },
          { separator: true },
          isSource ? null : { label: "Translate missing…", icon: "sparkles", onSelect: () => actions.translate(Object.assign(translateScope(), { targets: [lang] })) },
          { label: "Find and replace…", icon: "replace", onSelect: () => actions.findReplace(lang) },
          { label: "Clear translations…", icon: "eraser", onSelect: () => LS.tools.clearLanguage(lang, rows.slice(), isFiltered()) },
          { separator: true },
          isSource ? null : { label: "Set as source language", icon: "star", onSelect: () => store.setSourceLang(lang) },
          { label: "Rename language code…", icon: "pencil", onSelect: () => LS.tools.renameLanguage(lang) },
          { label: "Remove language…", icon: "trash-2", danger: true, disabled: p.languages.length <= 1, onSelect: () => LS.tools.removeLanguage(lang) },
        ],
        { placement: "bottom-end" }
      );
    }

    function isFiltered() {
      const v = store.view();
      return !!(v.search.trim() || v.namespace || v.status !== "all");
    }

    /** Keys the current filter shows, or null when nothing is filtered (= everything). */
    function scopeKeys() {
      return isFiltered() ? rows.slice() : null;
    }

    function translateScope() {
      const sel = grid.getSelection();
      if (sel.size) return { keys: Array.from(sel), scope: "selected" };
      if (isFiltered()) return { keys: rows.slice(), scope: "view" };
      return {};
    }

    /* ---- Add key ------------------------------------------------------------------------------ */

    function openAddKey() {
      const p = store.project();
      if (!p) return;
      if (addKeyBtn._popover && addKeyBtn._popover.isOpen) return addKeyBtn._popover.el.querySelector("input").focus();
      const ns = store.view().namespace;
      const active = grid.getActive().key;
      const seed = ns ? ns + "." : active ? LS.keys.splitKey(active).ns : "";
      const keyInput = h("input.input.mono", { type: "text", value: seed, placeholder: "e.g. checkout.title", autocomplete: "off", spellcheck: false, attrs: { autofocus: true } });
      const textInput = h("textarea.textarea", { rows: 2, placeholder: "Optional — you can also type it in the grid", spellcheck: true });
      const tag = langs.htmlLang(p.sourceLang);
      if (tag) textInput.lang = tag;
      const keyField = ui.field({ label: "Key", control: keyInput });
      const textField = ui.field({ label: langs.displayName(p.sourceLang) + " text", control: textInput });
      const suggest = h("div.suggest");
      const hint = h("div.addkey-hint", ui.kbd("enter"), " to add and keep going");
      const submitBtn = ui.button({ label: "Add key", variant: "primary", type: "submit" });

      const namespaces = [];
      (function collect(node) {
        for (const child of node.children) {
          namespaces.push(child.path);
          collect(child);
        }
      })(LS.keys.namespaceTree(Object.keys(p.entries)));

      const renderSuggestions = () => {
        const typed = keyInput.value.trim().toLowerCase();
        LS.dom.clear(suggest);
        if (typed.endsWith(".") && namespaces.includes(typed.slice(0, -1))) return;
        const prefix = typed.includes(".") ? typed.slice(0, typed.lastIndexOf(".") + 1) : "";
        const hits = namespaces
          .filter((n) => (n + ".").toLowerCase().startsWith(typed) && (n + ".").toLowerCase() !== typed && n.toLowerCase().startsWith(prefix))
          .sort((a, b) => a.split(".").length - b.split(".").length || util.natCompare(a, b))
          .slice(0, 6);
        for (const n of hits) {
          suggest.appendChild(
            h("button", { type: "button", tabIndex: -1, onClick: () => {
              keyInput.value = n + ".";
              keyInput.focus();
              renderSuggestions();
            } }, n + ".")
          );
        }
      };

      const form = h("form.addkey", { novalidate: true }, keyField, suggest, textField, h("div.addkey-foot", hint, submitBtn));
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const values = {};
        if (textInput.value) values[p.sourceLang] = textInput.value;
        const res = store.addKey(keyInput.value, values);
        if (!res.ok) {
          ui.setFieldError(keyField, res.error);
          if (res.exists) reveal(res.key);
          keyInput.focus();
          return;
        }
        ui.setFieldError(keyField, "");
        // The new key may be hidden by the current filter: show it anyway.
        if (!rows.includes(res.key)) resetFilters();
        reveal(res.key);
        if (inspectorOpen) inspector.show(res.key);
        LS.dom.replaceChildren(hint, icon("check", { size: 13 }), " Added ", h("span.mono", res.key));
        hint.style.color = "var(--success-text)";
        hint.style.display = "flex";
        hint.style.gap = "5px";
        hint.style.alignItems = "center";
        keyInput.value = LS.keys.splitKey(res.key).ns;
        textInput.value = "";
        keyInput.focus();
        renderSuggestions();
      });
      keyInput.addEventListener("input", () => {
        ui.setFieldError(keyField, "");
        renderSuggestions();
      });
      for (const input of [keyInput, textInput]) {
        input.addEventListener("keydown", (e) => {
          if (LS.dom.isIME(e)) return;
          if (e.key === "Enter" && (input === keyInput || e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            form.requestSubmit();
          }
        });
      }
      renderSuggestions();
      overlay.popover(addKeyBtn, form, { placement: "bottom-end", label: "Add key" });
      keyInput.setSelectionRange(keyInput.value.length, keyInput.value.length);
    }

    /* ---- Refresh ------------------------------------------------------------------------------- */

    function emptyNode() {
      const p = store.project();
      const total = store.stats(p).total;
      if (!total) {
        return ui.emptyState({
          icon: "languages",
          title: "No keys yet",
          text: "Add your first key, or import existing CSV or JSON files. You can also drop files anywhere on this window.",
          actions: [ui.button({ label: "Add key", icon: "plus", variant: "primary", onClick: () => openAddKey() }), ui.button({ label: "Import files", icon: "upload", onClick: () => actions.importFiles() })],
        });
      }
      const v = store.view();
      const what = v.status === "missing" ? "Nothing is missing" : v.status === "issues" ? "No issues found" : v.status === "pinned" ? "No pinned keys" : "No matching keys";
      const text =
        v.status === "missing" && !v.search
          ? "Every visible language has a translation for the keys in this view."
          : v.status === "issues" && !v.search
            ? "Placeholders and spacing match the source text everywhere."
            : v.status === "pinned" && !v.search
              ? "Pin keys to keep them at the top of the list."
              : "Try a different search or reset the filters.";
      return ui.emptyState({ icon: v.status === "all" || v.search ? "search-x" : "circle-check", title: what, text, actions: [ui.button({ label: "Reset filters", icon: "rotate-ccw", onClick: () => resetFilters() })] });
    }

    function refreshRows(opts) {
      computeRows();
      grid.setRows(rows, pinnedCount);
      grid.setEmpty(rows.length ? null : emptyNode());
      syncStatusTabs();
      syncStatus();
      syncBulkBar();
      if (!(opts && opts.keepIssues)) countIssuesSoon();
      if (inspectorOpen) inspector.refresh();
    }

    function refreshAll() {
      sortedKeys = null;
      grid.setColumns();
      refreshRows();
      syncColumnsBtn();
      syncNsChip();
      syncScopeBtn();
    }

    function reveal(key, lang) {
      if (!store.hasKey(key)) return;
      if (!rows.includes(key)) {
        resetFilters();
        if (!rows.includes(key)) refreshRows();
      }
      grid.reveal(key, lang);
      grid.focus();
      if (inspectorOpen) inspector.show(key);
    }

    /* ---- Store events ----------------------------------------------------------------------------- */

    sc.on("view", (d) => {
      const keys = d.keys;
      if (keys.includes("visibleLangs")) {
        grid.setColumns();
        syncColumnsBtn();
      }
      if (keys.includes("searchIn")) syncScopeBtn();
      if (keys.includes("namespace")) syncNsChip();
      if (keys.includes("search") && searchInput.value !== store.view().search && document.activeElement !== searchInput) searchInput.value = store.view().search;
      clearSearch.hidden = !searchInput.value;
      if (keys.some((k) => ["visibleLangs", "search", "searchIn", "status", "namespace", "sortBy", "sortDir"].includes(k))) refreshRows();
    });

    sc.on("entries", (d) => {
      if (d.kind === "cell") {
        // In place, never by replacing nodes: this often runs between mousedown and mouseup
        // (an edit committing on blur), and replaced nodes would swallow that click.
        grid.refreshRowValues(d.key);
        grid.refreshFigures();
        inspector.updateCell(d.key, d.lang);
        countIssuesSoon();
        // Missing count changes with single edits too; keep the tab figures fresh without reshuffling rows.
        const before = rows;
        const beforePinned = pinnedCount;
        computeRows();
        rows = before;
        pinnedCount = beforePinned;
        syncStatusTabs();
        return;
      }
      if (d.kind === "structure") return refreshAll();
      refreshRows();
      grid.refreshFigures();
    });

    sc.on("project", (d) => {
      const p = store.project();
      if (!p) return;
      if (document.activeElement !== titleInput) {
        titleInput.value = p.name;
        fitTitle();
      }
      const f = d.fields;
      if (f.includes("*") || f.includes("structure")) return; // the entries event does the full refresh
      if (f.includes("languages") || f.includes("sourceLang")) {
        grid.setColumns();
        refreshRows();
        syncColumnsBtn();
      } else if (f.includes("pinned")) refreshRows({ keepIssues: true });
    });

    sc.on("settings", (d) => {
      if (d.path === "density" || d.path === "*") grid.setDensity(store.state.settings.density);
      if (d.path === "ai.maxChars" && inspectorOpen) inspector.refresh();
    });

    sc.add(
      LS.translator.onBusy((cells) => {
        for (const c of cells) {
          grid.refreshCell(c.key, c.lang);
          if (inspector.key === c.key) inspector.setBusy(c.lang, LS.translator.isBusy(c.key, c.lang));
        }
      })
    );
    sc.add(LS.translator.onDone((cells) => grid.flash(cells)));

    sc.listen(document, "keydown", (e) => {
      if (e.defaultPrevented || document.querySelector("dialog[open]")) return;
      if (LS.dom.matchKey(e, "mod+i")) {
        e.preventDefault();
        setInspector(!inspectorOpen);
      } else if (LS.dom.matchKey(e, "mod+f") && !LS.dom.isEditable(e.target)) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
    });

    /* ---- Mount -------------------------------------------------------------------------------------- */

    container.append(topbar, h("div.tr-layout", h("div.tr-main", toolbar, grid.el, bulkSlot, statusbar), inspector.el));
    grid.setDensity(store.state.settings.density);
    refreshAll();
    setInspector(inspectorOpen);
    fitTitle();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitTitle);
    if (params && params.key) setTimeout(() => reveal(params.key), 0);

    return {
      update(next) {
        if (next && next.key) reveal(next.key);
      },
      addKey: openAddKey,
      /** Save anything being typed (open cell editor, details panel, title) without closing it. */
      flush() {
        grid.saveEdit();
        inspector.flush();
        if (document.activeElement === titleInput) commitTitle();
      },
      scope: () => ({ keys: rows.slice(), filtered: isFiltered() }),
      focusSearch() {
        searchInput.focus();
        searchInput.select();
      },
      reveal,
      destroy() {
        clearTimeout(issueTimer);
        applySearch.cancel();
        inspector.destroy();
        grid.commitEdit();
        grid.destroy();
        sc.destroy();
      },
    };
  }

  LS.views.translations = { mount };
})(globalThis.LS || (globalThis.LS = {}));
