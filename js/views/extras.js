/* Language Surface — welcome screen and command palette. */
(function (LS) {
  "use strict";

  const h = LS.h;
  const icon = LS.icon;
  const { store, util, ui, langs } = LS;

  /* ====================================================================== Welcome */

  function mountWelcome(container) {
    const sc = LS.shell.scope();
    const actions = LS.app.actions;
    const startCard = (o) =>
      h(
        "button.start-card",
        { type: "button", class: { primary: !!o.primary }, onClick: o.onClick },
        h("span.start-card-icon", icon(o.icon, { size: 16 })),
        h("span.start-card-title", o.title),
        h("span.start-card-sub", o.sub)
      );

    container.append(
      LS.shell.topbar({ title: "" }, sc),
      h(
        "div.welcome",
        h(
          "div.welcome-inner",
          h("img.welcome-mark", { src: "favicon.svg", alt: "", width: 48, height: 48 }),
          h("h1", "Translations that stay on your device."),
          h("p.welcome-lead", "Language Surface is a translation workspace that runs entirely in your browser. Edit every language side by side, bring your own files, and let AI fill the gaps when you want it to."),
          h(
            "div.welcome-actions",
            startCard({
              primary: true,
              icon: "rocket",
              title: "Explore the sample",
              sub: "A small app in four languages, ready to click around.",
              onClick: () => {
                store.createSampleProject();
                store.setUI({ seenWelcome: true });
              },
            }),
            startCard({ icon: "upload", title: "Import your files", sub: "CSV, JSON or plain text. One file or one per language.", onClick: () => actions.importFiles() }),
            startCard({ icon: "plus", title: "Start from scratch", sub: "Create an empty project and add keys as you go.", onClick: () => actions.newProject() })
          ),
          h(
            "div.welcome-points",
            h("div.point", icon("shield-check", { size: 16 }), h("div", h("b", "Local-first"), "No account and no server. Projects are saved in this browser and exported whenever you like.")),
            h("div.point", icon("file-braces", { size: 16 }), h("div", h("b", "Your formats"), "Nested or flat JSON, one file per language or all in one, and CSV for spreadsheets.")),
            h("div.point", icon("sparkles", { size: 16 }), h("div", h("b", "AI, optional"), "Add your own API key to translate missing strings with a glossary and length limits."))
          )
        )
      )
    );
    return { destroy: () => sc.destroy() };
  }

  /* ====================================================================== Command palette */

  let paletteOpen = false;

  function commands() {
    const a = LS.app.actions;
    const p = store.project();
    const dark = LS.shell.resolvedTheme() === "dark";
    const list = [];
    const add = (o) => list.push(o);
    if (p) {
      add({ label: "Add key", icon: "plus", kbd: "N", run: () => a.addKey() });
      add({ label: "Translate with AI…", icon: "sparkles", run: () => a.translate() });
      add({ label: "Find and replace…", icon: "replace", run: () => a.findReplace() });
      add({ label: "Import files…", icon: "upload", run: () => a.importFiles() });
      add({ label: "Export project…", icon: "download", run: () => a.exportProject() });
      add({ label: "Go to Translations", icon: "table-2", run: () => LS.app.navigate("translations") });
      add({ label: "Go to Languages", icon: "globe", run: () => LS.app.navigate("languages") });
      add({ label: "Go to Glossary", icon: "book-a", run: () => LS.app.navigate("glossary") });
      if (store.canUndo()) add({ label: "Undo", icon: "undo-2", kbd: "mod+Z", run: () => a.undo() });
      if (store.canRedo()) add({ label: "Redo", icon: "redo-2", kbd: "shift+mod+Z", run: () => a.redo() });
      add({ label: "Rename project…", icon: "pencil", run: () => a.renameProject() });
      add({ label: "Duplicate project", icon: "copy-plus", run: () => a.duplicateProject() });
    } else {
      add({ label: "Open the sample project", icon: "rocket", run: () => store.createSampleProject() });
      add({ label: "Import files…", icon: "upload", run: () => a.importFiles() });
    }
    add({ label: "New project…", icon: "folder-plus", run: () => a.newProject() });
    add({ label: "Go to Settings", icon: "settings", run: () => LS.app.navigate("settings") });
    add({ label: "Set up AI translation", icon: "key-round", run: () => LS.app.navigate("settings", { section: "ai" }) });
    add({ label: dark ? "Switch to light theme" : "Switch to dark theme", icon: dark ? "sun" : "moon", run: () => a.toggleTheme() });
    add({ label: "Keyboard shortcuts", icon: "keyboard", kbd: "?", run: () => a.shortcuts() });
    add({ label: "Show or hide sidebar", icon: "panel-left", kbd: "mod+B", run: () => a.toggleSidebar() });
    return list;
  }

  function score(text, q) {
    const t = text.toLowerCase();
    if (t === q) return 0;
    if (t.startsWith(q)) return 1;
    const at = t.indexOf(q);
    if (at !== -1) return 2 + (t[at - 1] === " " || t[at - 1] === "." || t[at - 1] === "_" ? 0 : 1);
    // loose: every word of the query appears somewhere
    const words = q.split(/\s+/).filter(Boolean);
    if (words.length > 1 && words.every((w) => t.includes(w))) return 5;
    return -1;
  }

  /** The better (lower) of two scores, where a negative score means "no match". */
  function best(a, b) {
    if (a < 0) return b;
    if (b < 0) return a;
    return Math.min(a, b);
  }

  function openPalette() {
    if (paletteOpen) return;
    paletteOpen = true;
    const p = store.project();
    const input = h("input.palette-input", { type: "text", placeholder: p ? "Search keys, text and commands" : "Search commands", autocomplete: "off", spellcheck: false, "aria-label": "Search", attrs: { autofocus: true }, role: "combobox", "aria-expanded": "true", "aria-controls": "palette-list" });
    const listEl = h("div.palette-list", { id: "palette-list", role: "listbox" });
    let items = [];
    let index = 0;

    function build() {
      const q = input.value.trim().toLowerCase();
      const groups = [];

      const cmds = commands()
        .map((c) => ({ c, s: q ? score(c.label, q) : 0 }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => a.s - b.s)
        .map((x) => ({ icon: x.c.icon, text: x.c.label, kbd: x.c.kbd, run: x.c.run }));

      const projects = store
        .projectList()
        .filter((pr) => !p || pr.id !== p.id)
        .map((pr) => ({ pr, s: q ? best(score(pr.name, q), score("Switch to " + pr.name, q)) : 0 }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => a.s - b.s)
        .slice(0, 6)
        .map((x) => ({ icon: "folder", text: "Switch to " + x.pr.name, sub: LS.shell.projectSummary(x.pr), run: () => store.selectProject(x.pr.id) }));

      let keys = [];
      if (p && q) {
        const src = p.sourceLang;
        const hits = [];
        for (const key in p.entries) {
          const text = store.getValue(key, src, p);
          let s = score(key, q);
          if (s < 0 && text) {
            const ts = score(text, q);
            if (ts >= 0) s = ts + 6;
          }
          if (s >= 0) hits.push({ key, text, s });
          if (hits.length > 4000) break;
        }
        hits.sort((a, b) => a.s - b.s || a.key.length - b.key.length || util.natCompare(a.key, b.key));
        keys = hits.slice(0, 30).map((x) => ({ icon: "hash", text: x.key, mono: true, sub: x.text, run: () => LS.app.actions.goToKey(x.key) }));
      }

      if (keys.length) groups.push({ title: "Keys", items: keys });
      if (cmds.length) groups.push({ title: q ? "Commands" : "Suggestions", items: q ? cmds : cmds.slice(0, 9) });
      if (projects.length) groups.push({ title: "Projects", items: projects });

      items = [];
      LS.dom.clear(listEl);
      if (!groups.length) {
        listEl.appendChild(h("div.pick-empty", "Nothing matches “" + input.value.trim() + "”."));
        return;
      }
      for (const g of groups) {
        listEl.appendChild(h("div.palette-group", { role: "presentation" }, g.title));
        for (const it of g.items) {
          const i = items.length;
          items.push(it);
          listEl.appendChild(
            h(
              "div.palette-item",
              {
                role: "option",
                id: "palette-opt-" + i,
                "aria-selected": "false",
                onClick: () => run(i),
                onPointermove: () => {
                  if (index !== i) {
                    index = i;
                    highlight(false);
                  }
                },
              },
              icon(it.icon, { size: 15 }),
              h("span.palette-item-text", { class: it.mono ? "mono" : "" }, it.text),
              it.sub ? h("span.palette-item-sub", it.sub) : null,
              it.kbd ? ui.kbd(it.kbd) : null
            )
          );
        }
      }
      index = 0;
      highlight(true);
    }

    function highlight(scroll) {
      const nodes = listEl.querySelectorAll(".palette-item");
      nodes.forEach((n, i) => {
        n.classList.toggle("active", i === index);
        n.setAttribute("aria-selected", String(i === index));
        if (i === index && scroll) n.scrollIntoView({ block: "nearest" });
      });
      if (items.length) input.setAttribute("aria-activedescendant", "palette-opt-" + index);
      else input.removeAttribute("aria-activedescendant");
    }

    function run(i) {
      const it = items[i];
      if (!it) return;
      dlg.close(null, true);
      // Let the dialog leave the top layer before the command opens its own UI.
      setTimeout(() => it.run(), 140);
    }

    input.addEventListener("input", build);
    input.addEventListener("keydown", (e) => {
      if (LS.dom.isIME(e)) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (items.length) index = (index + 1) % items.length;
        highlight(true);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (items.length) index = (index - 1 + items.length) % items.length;
        highlight(true);
      } else if (e.key === "Enter") {
        e.preventDefault();
        run(index);
      }
    });

    const dlg = LS.dialog.open({
      label: "Search and commands",
      class: "palette",
      dialogClass: "palette-dialog",
      body: null,
      onClose: () => {
        paletteOpen = false;
      },
    });
    LS.dom.replaceChildren(
      dlg.panel,
      h("div.palette-input-row", icon("search", { size: 16 }), input, ui.kbd("esc")),
      listEl,
      h("div.palette-foot", h("span", ui.kbd("up"), ui.kbd("down"), "to move"), h("span", ui.kbd("enter"), "to select"), p ? h("span", { style: "margin-left:auto" }, langs.label(p.sourceLang) + " text is searched too") : null)
    );
    build();
    input.focus();
  }

  LS.views.welcome = { mount: mountWelcome };
  LS.palette = { open: openPalette };
})(globalThis.LS || (globalThis.LS = {}));
