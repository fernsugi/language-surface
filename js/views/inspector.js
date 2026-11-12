/* Language Surface — key inspector: every language of one key, with room to write. */
(function (LS) {
  "use strict";

  const h = LS.h;
  const icon = LS.icon;
  const { store, util, ui, langs } = LS;

  /**
   * @param {Object} o
   *   onClose(), onNavigate(delta), onRenamed(oldKey, newKey), onDelete(key), onDuplicate(key),
   *   onTranslate(key, langs[]), getPosition(key) -> {index, total},
   *   isAlive() -> false once the panel's project is no longer the current one
   */
  function createInspector(o) {
    const el = h("aside.inspector", { "aria-label": "Key details" });
    let key = null;
    const fields = new Map(); // lang -> { root, ta, count, issues }
    const timers = new Map(); // lang -> debounce timer
    let keyInput = null;

    const alive = () => !o.isAlive || o.isAlive();

    /**
     * Save a field. `f.base` is the text the field last had in common with the store, so a field
     * is written only when the user really changed it — never because the store moved on
     * underneath it (undo, find & replace, another tab, an AI result).
     */
    function commitField(lang, immediate) {
      const f = fields.get(lang);
      if (!f || key == null) return;
      clearTimeout(timers.get(lang));
      const forKey = key;
      const run = () => {
        timers.delete(lang);
        if (!alive() || key !== forKey || fields.get(lang) !== f || !store.hasKey(forKey)) return;
        if (LS.dom.sameText(f.ta.value, f.base)) return;
        const value = f.ta.value;
        store.setValue(forKey, lang, value, { coalesce: true });
        f.base = value;
      };
      if (immediate) run();
      else timers.set(lang, setTimeout(run, 450));
    }

    function flushAll() {
      for (const lang of Array.from(timers.keys())) commitField(lang, true);
    }

    function updateFieldMeta(lang) {
      const f = fields.get(lang);
      const p = store.project();
      if (!f || !p) return;
      const value = f.ta.value;
      const n = util.charCount(value);
      const max = store.state.settings.ai.maxChars;
      f.count.textContent = n ? util.formatNumber(n) + (max > 0 && lang !== p.sourceLang ? " / " + max : "") : "";
      f.count.classList.toggle("over", max > 0 && lang !== p.sourceLang && n > max);
      const issues = lang === p.sourceLang ? [] : LS.text.checkTranslation(store.getValue(key, p.sourceLang), value);
      LS.dom.replaceChildren(
        f.issues,
        issues.map((x) => h("div.insp-issue", icon("triangle-alert", { size: 13 }), h("span", x.message)))
      );
      f.issues.hidden = !issues.length;
    }

    function buildField(lang, p) {
      const isSource = lang === p.sourceLang;
      const count = h("span.insp-count");
      const issues = h("div.insp-issues", { hidden: true });
      const ta = h("textarea.insp-text", {
        value: store.getValue(key, lang),
        rows: 2,
        placeholder: isSource ? "Source text" : "Add translation",
        spellcheck: true,
        dir: langs.isRtl(lang) ? "rtl" : "auto",
        "aria-label": langs.displayName(lang),
        dataset: { lang },
      });
      const tag = langs.htmlLang(lang);
      if (tag) ta.lang = tag;

      const tools = h("div.insp-field-tools", count);
      if (!isSource) {
        tools.appendChild(
          ui.button({
            icon: "sparkles",
            variant: "ghost",
            size: "sm",
            tip: "Translate from " + langs.label(p.sourceLang) + " with AI",
            ariaLabel: "Translate " + langs.displayName(lang) + " with AI",
            onClick: () => {
              flushAll();
              o.onTranslate(key, [lang]);
            },
          })
        );
      }
      tools.appendChild(
        ui.button({
          icon: "copy",
          variant: "ghost",
          size: "sm",
          tip: "Copy text",
          ariaLabel: "Copy " + langs.displayName(lang) + " text",
          onClick: async () => {
            if (await LS.dom.copyText(ta.value)) LS.toast("Copied", { duration: 1400 });
          },
        })
      );

      ta.addEventListener("input", () => {
        LS.dom.autosize(ta);
        updateFieldMeta(lang);
        commitField(lang, false);
      });
      ta.addEventListener("blur", () => commitField(lang, true));
      ta.addEventListener("keydown", (e) => {
        if (LS.dom.isIME(e)) return;
        if (e.key === "Escape") {
          e.preventDefault();
          ta.blur();
          o.onFocusGrid && o.onFocusGrid();
        } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          commitField(lang, true);
          if (e.shiftKey) o.onNavigate(-1);
          else o.onNavigate(1, lang);
        }
      });

      const root = h(
        "section.insp-field",
        { dataset: { lang } },
        h("div.insp-field-head", ui.langTag(lang, { source: isSource }), h("span.insp-lang-name", langs.displayName(lang) + (isSource ? " · source" : "")), tools),
        ta,
        issues
      );
      fields.set(lang, { root, ta, count, issues, base: store.getValue(key, lang) });
      return root;
    }

    function renderEmpty() {
      key = null;
      fields.clear();
      keyInput = null;
      LS.dom.replaceChildren(
        el,
        h("header.insp-head", h("div.insp-title", "Details"), ui.button({ icon: "x", variant: "ghost", tip: "Close details", onClick: () => o.onClose() })),
        h("div.insp-body", ui.emptyState({ icon: "text-cursor-input", title: "No key selected", text: "Select a key to see and edit all of its translations side by side." }))
      );
    }

    function render() {
      const p = store.project();
      if (!p || key == null || !store.hasKey(key)) return renderEmpty();
      fields.clear();
      const pinned = p.pinned.includes(key);

      // `input` is this render's own element: store events fired by a rename re-render the panel,
      // so the shared `keyInput` reference may already point elsewhere when handlers resume.
      const input = h("input.insp-key", { type: "text", value: key, spellcheck: false, autocomplete: "off", "aria-label": "Key name", title: "Rename key" });
      keyInput = input;
      const shownKey = key;
      const applyRename = () => {
        if (key !== shownKey || !input.isConnected || !alive()) return true;
        const next = input.value;
        if (LS.keys.normalizeKey(next) === shownKey) {
          input.value = shownKey;
          input.classList.remove("invalid");
          return true;
        }
        flushAll();
        const res = store.renameKey(shownKey, next);
        if (!res.ok) {
          input.classList.add("invalid");
          LS.toast(res.error, { type: "error" });
          return false;
        }
        o.onRenamed(shownKey, res.key);
        return true;
      };
      input.addEventListener("keydown", (e) => {
        if (LS.dom.isIME(e)) return;
        if (e.key === "Enter") {
          e.preventDefault();
          if (applyRename() && input.isConnected) input.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          input.value = shownKey;
          input.classList.remove("invalid");
          input.blur();
        }
      });
      input.addEventListener("blur", () => {
        if (input.isConnected && key === shownKey && input.value !== shownKey && !input.classList.contains("invalid")) applyRename();
      });
      input.addEventListener("input", () => input.classList.remove("invalid"));

      const moreBtn = ui.button({
        icon: "ellipsis",
        variant: "ghost",
        tip: "More",
        ariaLabel: "More actions",
        onClick: (e) =>
          LS.overlay.toggle(e.currentTarget, () =>
            LS.overlay.menu(
              e.currentTarget,
              [
                { label: "Duplicate key", icon: "copy-plus", onSelect: () => o.onDuplicate(key) },
                { label: "Translate missing with AI", icon: "sparkles", onSelect: () => translateMissing() },
                { separator: true },
                { label: "Delete key", icon: "trash-2", danger: true, onSelect: () => o.onDelete(key) },
              ],
              { placement: "bottom-end" }
            )
          ),
      });

      const head = h(
        "header.insp-head",
        input,
        ui.button({
          icon: "copy",
          variant: "ghost",
          tip: "Copy key",
          onClick: async () => {
            if (await LS.dom.copyText(key)) LS.toast("Key copied", { description: key, duration: 1600 });
          },
        }),
        ui.button({
          icon: pinned ? "pin-off" : "pin",
          variant: "ghost",
          tip: pinned ? "Unpin" : "Pin to top",
          onClick: () => store.setPinned([key], !pinned),
        }),
        moreBtn,
        ui.button({ icon: "x", variant: "ghost", tip: "Close details", onClick: () => o.onClose() })
      );

      const order = [p.sourceLang].concat(p.languages.filter((l) => l !== p.sourceLang));
      const bodyEl = h(
        "div.insp-body",
        order.map((lang) => buildField(lang, p))
      );

      const missing = order.filter((l) => l !== p.sourceLang && !store.getValue(key, l));
      const pos = o.getPosition ? o.getPosition(key) : null;
      const foot = h(
        "footer.insp-foot",
        missing.length && store.getValue(key, p.sourceLang)
          ? ui.button({ label: "Translate " + (missing.length === 1 ? langs.label(missing[0]) : missing.length + " missing"), icon: "sparkles", variant: "accent", size: "sm", onClick: () => translateMissing() })
          : null,
        h(
          "div.insp-nav",
          pos ? h("span.insp-pos", util.formatNumber(pos.index + 1) + " / " + util.formatNumber(pos.total)) : null,
          ui.button({ icon: "chevron-up", variant: "ghost", tip: "Previous key", disabled: pos ? pos.index <= 0 : false, onClick: () => o.onNavigate(-1) }),
          ui.button({ icon: "chevron-down", variant: "ghost", tip: "Next key", disabled: pos ? pos.index >= pos.total - 1 : false, onClick: () => o.onNavigate(1) })
        )
      );

      LS.dom.replaceChildren(el, head, bodyEl, foot);
      for (const lang of order) {
        LS.dom.autosize(fields.get(lang).ta);
        updateFieldMeta(lang);
      }
    }

    function translateMissing() {
      const p = store.project();
      if (!p || key == null) return;
      flushAll();
      const targets = p.languages.filter((l) => l !== p.sourceLang && !store.getValue(key, l));
      if (!targets.length) return LS.toast("Nothing to translate", { description: "Every language already has a translation for this key." });
      o.onTranslate(key, targets);
    }

    const api = {
      el,
      get key() {
        return key;
      },

      /** Show a key (or the empty state when null). */
      show(nextKey) {
        if (nextKey === key && nextKey != null && store.hasKey(nextKey)) return;
        flushAll();
        key = nextKey == null ? null : nextKey;
        render();
      },

      /** Re-render completely (languages, pin state or the key itself changed). */
      refresh() {
        flushAll();
        const focused = document.activeElement && el.contains(document.activeElement) ? document.activeElement.dataset.lang : null;
        render();
        if (focused && fields.has(focused)) fields.get(focused).ta.focus({ preventScroll: true });
      },

      /** A single cell changed elsewhere (grid edit, AI, undo). */
      updateCell(changedKey, lang) {
        if (changedKey !== key) return;
        const p = store.project();
        const f = fields.get(lang);
        if (f) {
          const value = store.getValue(key, lang);
          // Follow the store unless the user has typed something here that is not saved yet —
          // even when the field has focus (e.g. an AI result arriving for the field in use).
          const untouched = LS.dom.sameText(f.ta.value, f.base);
          if (untouched && !LS.dom.sameText(f.ta.value, value)) {
            f.ta.value = value;
            LS.dom.autosize(f.ta);
          }
          f.base = value;
        }
        // Source text affects every language's checks; other cells only their own.
        if (p && lang === p.sourceLang) for (const l of fields.keys()) updateFieldMeta(l);
        else updateFieldMeta(lang);
      },

      setBusy(lang, busy) {
        const f = fields.get(lang);
        if (f) f.root.classList.toggle("busy", !!busy);
      },

      focusField(lang) {
        const f = fields.get(lang);
        if (f) {
          f.ta.focus();
          f.ta.setSelectionRange(f.ta.value.length, f.ta.value.length);
        }
      },

      focusKey() {
        if (keyInput) {
          keyInput.focus();
          keyInput.select();
        }
      },

      flush: flushAll,

      destroy() {
        flushAll();
      },
    };

    renderEmpty();
    return api;
  }

  LS.createInspector = createInspector;
})(globalThis.LS || (globalThis.LS = {}));
