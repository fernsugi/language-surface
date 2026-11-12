/* Language Surface — small popover pickers: project switcher, language picker, column visibility. */
(function (LS) {
  "use strict";

  const h = LS.h;
  const icon = LS.icon;
  const { store, util, ui, overlay, langs } = LS;

  /* ---- Project switcher ----------------------------------------------------------- */

  function projects(anchor) {
    const list = store.projectList();
    const currentId = store.state.ui.selectedProjectId;
    let ctl = null;
    const items = [];

    if (list.length) items.push({ heading: "Projects" });
    for (const p of list) {
      items.push({
        custom: h(
          "button.menu-item.project-row",
          {
            type: "button",
            role: "menuitemradio",
            "aria-checked": String(p.id === currentId),
            tabIndex: -1,
            onClick: () => {
              ctl.close();
              store.selectProject(p.id);
            },
          },
          LS.shell.avatar(p, true),
          h("span.project-row-text", h("div.project-row-name", p.name), h("div.project-row-sub", LS.shell.projectSummary(p))),
          p.id === currentId ? icon("check", { size: 14 }) : null
        ),
      });
    }
    if (list.length) items.push({ separator: true });
    items.push({ label: "New project…", icon: "plus", onSelect: () => LS.app.actions.newProject() });
    items.push({ label: "Import files…", icon: "upload", onSelect: () => LS.app.actions.importFiles() });
    if (!list.length) items.push({ label: "Open the sample project", icon: "rocket", onSelect: () => store.createSampleProject() });

    ctl = overlay.menu(anchor, items, { class: "projects-pop", matchWidth: true, focus: "first" });
    return ctl;
  }

  /* ---- Language picker -------------------------------------------------------------- */

  /**
   * Searchable language list. Custom codes (e.g. "zhs") can be added as typed.
   * @param {Element} anchor
   * @param {{exclude?: string[], onPick: (code: string) => void, placement?: string, actionLabel?: string}} o
   */
  function language(anchor, o) {
    const exclude = (o.exclude || []).map(langs.normalize);
    const input = h("input.input", { type: "text", placeholder: "Search or type a code, e.g. fr-ca", autocomplete: "off", spellcheck: false, attrs: { autofocus: true }, "aria-label": "Language" });
    const listEl = h("div.pick-list", { role: "listbox" });
    let options = [];
    let index = 0;
    let ctl = null;

    const pick = (code) => {
      ctl.close();
      o.onPick(code);
    };

    const render = () => {
      const q = input.value.trim();
      const results = langs.search(q, { limit: 8, exclude });
      options = results.map((r) => ({ code: r.code, name: r.name, native: langs.nativeName(r.code) }));
      const code = langs.normalize(q);
      if (code && !options.some((x) => x.code === code)) {
        if (exclude.includes(code)) options.unshift({ code, name: langs.displayName(code), disabled: true, note: "Already added" });
        else options.push({ code, name: langs.name(code) || "Custom code", custom: !langs.name(code), note: langs.name(code) ? "" : "Use as typed" });
      }
      index = Math.max(0, options.findIndex((x) => !x.disabled));
      LS.dom.clear(listEl);
      if (!options.length) {
        listEl.appendChild(h("div.pick-empty", "No matching language. Type a code to add your own."));
        return;
      }
      options.forEach((opt, i) => {
        listEl.appendChild(
          h(
            "div.pick-item",
            {
              role: "option",
              "aria-selected": String(i === index),
              "aria-disabled": opt.disabled ? "true" : null,
              class: { focus: i === index },
              style: opt.disabled ? { opacity: 0.5, cursor: "default" } : null,
              onClick: () => !opt.disabled && pick(opt.code),
              onPointermove: () => {
                if (opt.disabled || index === i) return;
                index = i;
                highlight();
              },
            },
            ui.langTag(opt.code),
            h("span.pick-item-text", opt.name),
            h("span.pick-item-sub", opt.note || opt.native || "")
          )
        );
      });
    };

    const highlight = () => {
      Array.from(listEl.children).forEach((el, i) => {
        el.classList.toggle("focus", i === index);
        el.setAttribute("aria-selected", String(i === index));
        if (i === index) el.scrollIntoView({ block: "nearest" });
      });
    };

    const move = (delta) => {
      if (!options.length) return;
      let i = index;
      for (let n = 0; n < options.length; n++) {
        i = (i + delta + options.length) % options.length;
        if (!options[i].disabled) break;
      }
      index = i;
      highlight();
    };

    input.addEventListener("input", render);
    input.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        move(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        move(-1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const opt = options[index];
        if (opt && !opt.disabled) pick(opt.code);
      }
    });

    render();
    ctl = overlay.popover(anchor, h("div.pick", h("div.pick-search", input), listEl), { placement: o.placement || "bottom-start", label: "Add language" });
    return ctl;
  }

  /* ---- Column visibility ----------------------------------------------------------- */

  function columns(anchor) {
    const p = store.project();
    if (!p) return null;
    const listEl = h("div.pick-list");
    let ctl = null;

    const render = () => {
      const v = store.view();
      const stats = store.stats(p);
      LS.dom.clear(listEl);
      for (const code of p.languages) {
        const visible = v.visibleLangs.includes(code);
        const onlyOne = visible && v.visibleLangs.length === 1;
        const toggle = () => {
          if (onlyOne) return;
          const next = p.languages.filter((l) => (l === code ? !visible : v.visibleLangs.includes(l)));
          store.setView({ visibleLangs: next });
          render();
        };
        listEl.appendChild(
          h(
            "label.pick-item",
            { title: onlyOne ? "At least one language stays visible" : "" },
            ui.checkbox({ checked: visible, disabled: onlyOne, onChange: toggle, ariaLabel: "Show " + langs.displayName(code) }),
            ui.langTag(code, { source: code === p.sourceLang }),
            h("span.pick-item-text", langs.displayName(code)),
            h("span.pick-item-sub.num", util.completion(stats.filled[code] || 0, stats.total) + "%")
          )
        );
      }
    };
    render();

    const foot = h(
      "div.pick-foot",
      ui.button({
        label: "Show all",
        size: "sm",
        variant: "ghost",
        onClick: () => {
          store.setView({ visibleLangs: p.languages.slice() });
          render();
        },
      }),
      h("span.spacer"),
      ui.button({
        label: "Manage languages",
        size: "sm",
        variant: "ghost",
        iconRight: "chevron-right",
        onClick: () => {
          ctl.close();
          LS.app.navigate("languages");
        },
      })
    );
    ctl = overlay.popover(anchor, h("div.pick", listEl, foot), { placement: "bottom-end", label: "Visible languages", autoFocus: true });
    return ctl;
  }

  LS.pickers = { projects, language, columns };
})(globalThis.LS || (globalThis.LS = {}));
