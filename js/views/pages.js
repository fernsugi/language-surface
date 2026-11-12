/* Language Surface — Languages and Glossary pages. */
(function (LS) {
  "use strict";

  const h = LS.h;
  const icon = LS.icon;
  const { store, util, ui, overlay, langs } = LS;

  /* ====================================================================== Languages */

  function mountLanguages(container) {
    const sc = LS.shell.scope();
    const addBtn = ui.button({ label: "Add language", icon: "plus", variant: "primary", onClick: (e) => overlay.toggle(e.currentTarget, () => LS.tools.addLanguage(e.currentTarget, { placement: "bottom-end" })) });
    const page = h("div.page-inner");
    container.append(LS.shell.topbar({ title: "Languages", crumb: true }, sc), h("div.page", page));

    function row(p, lang, index, stats) {
      const isSource = lang === p.sourceLang;
      const filled = stats.filled[lang] || 0;
      const pct = util.completion(filled, stats.total);
      const missing = stats.total - filled;
      const visible = store.view().visibleLangs.includes(lang);
      const native = langs.nativeName(lang);
      const known = !!langs.name(lang);

      const menuBtn = ui.button({
        icon: "ellipsis",
        variant: "ghost",
        ariaLabel: "More actions for " + langs.displayName(lang),
        tip: "More",
        onClick: (e) =>
          overlay.toggle(e.currentTarget, () =>
            overlay.menu(
              e.currentTarget,
              [
                isSource ? null : { label: "Set as source language", icon: "star", onSelect: () => store.setSourceLang(lang) },
                { label: "Move up", icon: "move-up", disabled: index === 0, onSelect: () => store.moveLanguage(lang, -1) },
                { label: "Move down", icon: "move-down", disabled: index === p.languages.length - 1, onSelect: () => store.moveLanguage(lang, 1) },
                { separator: true },
                { label: "Rename code…", icon: "pencil", onSelect: () => LS.tools.renameLanguage(lang) },
                { label: "Find and replace…", icon: "replace", onSelect: () => LS.tools.findReplace(lang) },
                { label: "Clear translations…", icon: "eraser", disabled: !filled, onSelect: () => LS.tools.clearLanguage(lang, Object.keys(p.entries), false) },
                { separator: true },
                { label: "Remove language…", icon: "trash-2", danger: true, disabled: p.languages.length <= 1, onSelect: () => LS.tools.removeLanguage(lang) },
              ],
              { placement: "bottom-end" }
            )
          ),
      });

      return h(
        "div.lang-row",
        h(
          "div.lang-ident",
          ui.langTag(lang, { source: isSource, large: true }),
          h(
            "div.lang-names",
            h("div.lang-name", h("span", langs.displayName(lang)), isSource ? h("span.badge.accent", "Source") : null, !known ? h("span.badge", { "data-tip": "Not a standard code. That is fine: it is exported exactly as written." }, "Custom code") : null),
            native ? h("div.lang-native", { lang: langs.htmlLang(lang) || null }, native) : null
          )
        ),
        h(
          "div.lang-progress",
          ui.meter(filled, stats.total, { label: langs.displayName(lang) + " completion" }),
          h("div.lang-figure", h("b", pct + "%"), " · " + util.formatNumber(filled) + " / " + util.formatNumber(stats.total))
        ),
        h(
          "div.lang-actions",
          !isSource && missing > 0
            ? ui.button({ icon: "sparkles", variant: "ghost", tip: "Translate " + util.plural(missing, "missing string") + " with AI", ariaLabel: "Translate missing " + langs.displayName(lang), onClick: () => LS.app.actions.translate({ targets: [lang] }) })
            : null,
          ui.button({
            icon: visible ? "eye" : "eye-off",
            variant: "ghost",
            tip: visible ? "Shown in the grid — click to hide" : "Hidden in the grid — click to show",
            ariaLabel: (visible ? "Hide " : "Show ") + langs.displayName(lang) + " in the grid",
            onClick: () => {
              const v = store.view();
              if (visible && v.visibleLangs.length <= 1) return LS.toast("At least one language stays visible");
              store.setView({ visibleLangs: p.languages.filter((l) => (l === lang ? !visible : v.visibleLangs.includes(l))) });
            },
          }),
          menuBtn
        )
      );
    }

    function render() {
      const p = store.project();
      if (!p) return;
      const stats = store.stats(p);
      const cells = stats.total * p.languages.length;
      const filledAll = p.languages.reduce((n, l) => n + (stats.filled[l] || 0), 0);
      LS.dom.replaceChildren(
        page,
        h(
          "div.page-head",
          h("div.page-head-text", h("h2.page-title", "Languages"), h("p.page-desc", "Every key is translated into these languages. The source language is the one AI translates from.")),
          h("div.page-head-actions", addBtn)
        ),
        h(
          "div.stat-row",
          h("div.stat", h("div.stat-label", "Keys"), h("div.stat-value", util.formatNumber(stats.total)), h("div.stat-sub", util.plural(p.languages.length, "language"))),
          h("div.stat", h("div.stat-label", "Translated"), h("div.stat-value", util.completion(filledAll, cells) + "%"), h("div.stat-sub", util.formatNumber(filledAll) + " of " + util.formatNumber(cells) + " strings")),
          h("div.stat", h("div.stat-label", "Complete keys"), h("div.stat-value", util.formatNumber(stats.complete)), h("div.stat-sub", stats.total ? "in every language" : "No keys yet"))
        ),
        h("div.card.lang-list", p.languages.map((lang, i) => row(p, lang, i, stats)))
      );
    }

    const renderSoon = util.debounce(render, 80);
    sc.on("project", render);
    sc.on("entries", renderSoon);
    sc.on("view", (d) => {
      if (d.keys.includes("visibleLangs")) render();
    });
    render();
    return {
      destroy() {
        renderSoon.cancel();
        sc.destroy();
      },
    };
  }

  /* ====================================================================== Glossary */

  function mountGlossary(container) {
    const sc = LS.shell.scope();
    const page = h("div.page-inner");
    container.append(LS.shell.topbar({ title: "Glossary", crumb: true }, sc), h("div.page", page));
    let filter = "";
    let contextTimer = 0;

    const pairOptions = (p) => [{ value: "all", label: "Any" }].concat(p.languages.map((l) => ({ value: l, label: langs.label(l) })));

    function pairLabel(code) {
      return code === "all" ? h("span.lang-tag", "ANY") : ui.langTag(code);
    }

    function termsCard(p) {
      const draft = { sourceLang: p.sourceLang, targetLang: p.languages.find((l) => l !== p.sourceLang) || "all", from: "", to: "" };
      const fromInput = h("input.input", { type: "text", placeholder: "Source term, e.g. Health Potion", autocomplete: "off", "aria-label": "Source term" });
      const toInput = h("input.input", { type: "text", placeholder: "Required translation", autocomplete: "off", "aria-label": "Translation" });
      const srcSel = ui.select({ value: draft.sourceLang, options: pairOptions(p), ariaLabel: "From language", onChange: (v) => (draft.sourceLang = v) });
      const tgtSel = ui.select({ value: draft.targetLang, options: pairOptions(p), ariaLabel: "To language", onChange: (v) => (draft.targetLang = v) });
      const errorEl = h("div.field-error", { hidden: true, role: "alert", style: "grid-column:1/-1" });

      const form = h(
        "form.term-form",
        { novalidate: true },
        h("div.field", h("span.field-label", "Languages"), h("div.pair", srcSel, icon("arrow-right", { size: 13 }), tgtSel)),
        h("div.field", h("label.field-label", "Term"), fromInput),
        h("div.field", h("label.field-label", "Translation"), toInput),
        ui.button({ label: "Add term", icon: "plus", variant: "primary", type: "submit" }),
        errorEl
      );
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const res = store.addRule({ sourceLang: draft.sourceLang, targetLang: draft.targetLang, from: fromInput.value, to: toInput.value });
        if (!res.ok) {
          errorEl.textContent = res.error;
          errorEl.hidden = false;
          (fromInput.value.trim() ? toInput : fromInput).focus();
          return;
        }
        // Re-render happens through the store event; restore the form state afterwards.
        requestAnimationFrame(() => {
          const next = page.querySelector(".term-form input");
          if (next) next.focus();
        });
      });
      for (const input of [fromInput, toInput]) input.addEventListener("input", () => (errorEl.hidden = true));

      const q = filter.trim().toLowerCase();
      const rules = q ? p.glossary.filter((g) => g.from.toLowerCase().includes(q) || g.to.toLowerCase().includes(q)) : p.glossary;

      const rowsEl = rules.map((g) => {
        const commit = (field, input) => {
          const value = input.value.trim();
          if (value === g[field] || !sc.alive()) return;
          const res = store.updateRule(g.id, { [field]: value });
          if (!res.ok) {
            LS.toast(res.error, { type: "error" });
            input.value = g[field];
          }
        };
        const mk = (field, label) => {
          const input = h("input.term-input", { type: "text", value: g[field], "aria-label": label, autocomplete: "off" });
          input.addEventListener("blur", () => commit(field, input));
          input.addEventListener("keydown", (e) => {
            if (LS.dom.isIME(e)) return;
            if (e.key === "Enter") input.blur();
            else if (e.key === "Escape") {
              input.value = g[field];
              input.blur();
            }
          });
          return input;
        };
        const stale = (g.sourceLang !== "all" && !p.languages.includes(g.sourceLang)) || (g.targetLang !== "all" && !p.languages.includes(g.targetLang));
        return h(
          "div.term-row",
          h("div.term-pair", { title: stale ? "This language is no longer in the project, so the term is never used." : "" }, pairLabel(g.sourceLang), icon("arrow-right", { size: 12 }), pairLabel(g.targetLang), stale ? icon("triangle-alert", { size: 13, class: "warn-icon" }) : null),
          mk("from", "Source term"),
          mk("to", "Translation"),
          ui.button({
            icon: "trash-2",
            variant: "ghost",
            tip: "Remove term",
            ariaLabel: "Remove term " + g.from,
            onClick: () => {
              store.removeRule(g.id);
              LS.toast("Term removed", { description: g.from + " → " + g.to, action: LS.app.actions.undoAction() });
            },
          })
        );
      });

      let listBody;
      if (!p.glossary.length) {
        listBody = ui.emptyState({ icon: "book-a", title: "No terms yet", text: "Add product names, character names or UI terms that must always be translated the same way." });
      } else if (!rules.length) {
        listBody = ui.emptyState({ icon: "search-x", title: "No matching terms", text: "Nothing matches “" + filter + "”." });
      } else {
        listBody = [h("div.term-head", h("span", "Languages"), h("span", "Term"), h("span", "Translation"), h("span")), rowsEl];
      }
      return h("div.card", form, listBody);
    }

    function render() {
      const p = store.project();
      if (!p) return;
      const active = document.activeElement;
      const keepContextFocus = active && active.classList && active.classList.contains("context-input");
      const searchInput = h("input.input", {
        type: "search",
        placeholder: "Filter terms",
        value: filter,
        "aria-label": "Filter terms",
        style: "width:200px",
        onInput: (e) => {
          filter = e.target.value;
          const card = page.querySelector(".card");
          if (card) card.replaceWith(termsCard(store.project()));
        },
      });

      const contextInput = h("textarea.textarea.context-input", {
        rows: 4,
        value: p.context,
        placeholder: "e.g. A fantasy RPG for teenagers. Keep UI text short, use a friendly informal tone, never translate character names.",
        "aria-label": "Instructions for AI translation",
      });
      const savedNote = h("span.field-hint", "Sent with every AI translation in this project.");
      // Only ever written to the project this page was opened for.
      const saveContext = () => {
        clearTimeout(contextTimer);
        if (sc.alive() && contextInput.isConnected && !LS.dom.sameText(contextInput.value, store.project().context)) store.setContext(contextInput.value);
      };
      contextInput.addEventListener("input", () => {
        LS.dom.autosize(contextInput);
        clearTimeout(contextTimer);
        contextTimer = setTimeout(saveContext, 500);
      });
      contextInput.addEventListener("blur", saveContext);

      if (keepContextFocus) {
        // Typing in the instructions box triggered this refresh; leave the page alone.
        return;
      }

      LS.dom.replaceChildren(
        page,
        h("div.page-head", h("div.page-head-text", h("h2.page-title", "Glossary"), h("p.page-desc", "Guide AI translation with fixed terms and a description of your product. Both apply to this project only."))),
        h(
          "section.section",
          h("div.section-head", h("h3.section-title", "Terms"), h("span.section-desc", p.glossary.length ? util.plural(p.glossary.length, "term") : ""), h("span.spacer"), p.glossary.length > 6 ? searchInput : null),
          termsCard(p),
          h(
            "p.field-hint",
            { style: "margin-top:10px" },
            "Matching ignores case. Use ",
            h("code", "*"),
            " for any single character, so ",
            h("code", "Lv.*"),
            " covers Lv.1, Lv.2 and so on. Only terms that occur in a text are sent with it."
          )
        ),
        h("section.section", h("div.section-head", h("h3.section-title", "Instructions")), h("div.field", contextInput, savedNote))
      );
      LS.dom.autosize(contextInput);
    }

    sc.on("project", (d) => {
      if (d.fields.includes("glossary") || d.fields.includes("languages") || d.fields.includes("sourceLang") || d.fields.includes("context") || d.fields.includes("*") || d.fields.includes("structure")) render();
    });
    render();
    const flush = () => {
      clearTimeout(contextTimer);
      const input = page.querySelector(".context-input");
      if (input && sc.alive() && !LS.dom.sameText(input.value, store.project().context)) store.setContext(input.value);
    };
    return {
      flush,
      destroy() {
        flush();
        sc.destroy();
      },
    };
  }

  LS.views.languages = { mount: mountLanguages };
  LS.views.glossary = { mount: mountGlossary };
})(globalThis.LS || (globalThis.LS = {}));
