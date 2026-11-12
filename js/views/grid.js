/* Language Surface — the translations grid.
 *
 * A virtualized key × language table: only the rows in view exist in the DOM, so projects with
 * tens of thousands of keys stay fast. Cells are edited in place with a floating textarea.
 */
(function (LS) {
  "use strict";

  const h = LS.h;
  const icon = LS.icon;
  const { store, util, ui, langs } = LS;

  const ROW_HEIGHTS = { compact: 38, comfortable: 58, tall: 98 };
  const HEAD_H = 38;
  const COL_DEFAULT = 220;
  const COL_MIN = 140;
  const COL_MAX = 900;
  const KEY_MIN = 160;
  const KEY_MAX = 720;
  const FILL_W = 44;
  const OVERSCAN = 6;
  const KEY_COL = "@key";
  const MAX_CELL_CHARS = 700;

  let gridSeq = 0;

  /**
   * @param {Object} o callbacks
   *   onCommit(key, lang, value)          a cell edit was confirmed
   *   onActiveChange({key, col})          active cell moved
   *   onOpenKey(key)                      key cell clicked / Enter on key column
   *   onRowMenu(anchorOrEvent, key, lang) row "more" button or right click
   *   onHeaderMenu(anchor, lang)          column menu button
   *   onAddLanguage(anchor)               "+" in the header
   *   onSelectionChange(Set)              checked rows changed
   *   onTogglePin(key), onDeleteKeys(keys), onCopy(text, what), onTranslateCell(key, lang)
   *   getIssues(key, lang) -> array, isBusy(key, lang) -> bool, getFinder() -> {keys?, text?}
   */
  function createGrid(o) {
    const gid = "g" + ++gridSeq;
    const styleEl = document.createElement("style");
    const head = h("div.grid-head", { role: "row", "aria-rowindex": "1" });
    const body = h("div.grid-body", { role: "rowgroup" });
    const emptySlot = h("div.grid-empty", { hidden: true });
    const el = h("div.grid", { class: gid, tabIndex: 0, role: "grid", "aria-label": "Translations" }, styleEl, head, body);
    body.appendChild(emptySlot);

    let rows = [];
    let indexOf = new Map();
    let pinnedCount = 0;
    let cols = [];
    let rowH = ROW_HEIGHTS.compact;
    const rendered = new Map(); // row index -> element
    let active = { key: null, col: null };
    let selection = new Set();
    let anchorIndex = -1;
    let editor = null; // { key, lang, el, original }
    let raf = 0;
    let destroyed = false;

    const project = () => store.project();
    const view = () => store.view();

    /* ---- Columns -------------------------------------------------------------- */

    let narrow = false;

    function columnCSS() {
      const v = view();
      const width = el.clientWidth || 1200;
      narrow = width < 640;
      // On phones the key column may not eat the whole screen.
      const keyW = narrow ? Math.min(util.clamp(v.keyWidth || 250, 120, KEY_MAX), Math.round(width * 0.42)) : util.clamp(v.keyWidth || 250, KEY_MIN, KEY_MAX);
      const colDefault = narrow ? Math.max(170, Math.round(width * 0.5)) : COL_DEFAULT;
      let total = keyW + FILL_W;
      let anyAuto = false;
      const rules = ["." + gid + " .c-key{flex:0 0 " + keyW + "px}"];
      cols.forEach((lang, i) => {
        const w = v.colWidths[lang];
        if (w) {
          rules.push("." + gid + " .col-" + i + "{flex:0 0 " + w + "px}");
          total += w;
        } else {
          anyAuto = true;
          rules.push("." + gid + " .col-" + i + "{flex:1 0 " + colDefault + "px}");
          total += colDefault;
        }
      });
      rules.push("." + gid + " .c-fill{flex:" + (anyAuto ? "0 0 " : "1 0 ") + FILL_W + "px}");
      rules.push("." + gid + " .grid-head,." + gid + " .grid-body{min-width:" + total + "px}");
      styleEl.textContent = rules.join("");
    }

    function sortState(col) {
      const v = view();
      const id = col === KEY_COL ? "key" : "lang:" + col;
      return v.sortBy === id ? v.sortDir : null;
    }

    function sortButton(col, content) {
      const dir = sortState(col);
      const btn = h(
        "button.gh-sort",
        { type: "button", class: { sorted: !!dir }, dataset: { sort: col }, "data-tip": dir === "asc" ? "Sorted A → Z" : dir === "desc" ? "Sorted Z → A" : "Sort" },
        content,
        icon(dir === "desc" ? "arrow-up" : "arrow-down", { size: 12, class: "sort-icon" })
      );
      return btn;
    }

    function renderHead() {
      const p = project();
      if (!p) return;
      const stats = store.stats(p);
      LS.dom.clear(head);
      el.setAttribute("aria-colcount", String(cols.length + 1));

      const allChecked = rows.length > 0 && rows.every((k) => selection.has(k));
      const someChecked = !allChecked && rows.some((k) => selection.has(k));
      const keyHead = h(
        "div.gh.gh-key.c-key",
        { role: "columnheader", "aria-sort": ariaSort(sortState(KEY_COL)) },
        ui.checkbox({
          checked: allChecked,
          indeterminate: someChecked,
          ariaLabel: "Select all listed keys",
          class: "head-check",
          onChange: (checked) => {
            selection = checked ? new Set(rows) : new Set();
            anchorIndex = -1;
            syncSelection();
          },
        }),
        sortButton(KEY_COL, h("span.gh-name", "Key")),
        h("span.gh-pct", util.formatNumber(rows.length) + (rows.length !== stats.total ? " of " + util.formatNumber(stats.total) : "")),
        h("div.col-resize", { dataset: { resize: KEY_COL }, "aria-hidden": "true" })
      );
      head.appendChild(keyHead);

      cols.forEach((lang, i) => {
        const filled = stats.filled[lang] || 0;
        const pct = util.completion(filled, stats.total);
        const isSource = lang === p.sourceLang;
        head.appendChild(
          h(
            "div.gh.gh-lang.col-" + i,
            { role: "columnheader", dataset: { lang }, "aria-sort": ariaSort(sortState(lang)) },
            sortButton(lang, [ui.langTag(lang, { source: isSource, title: isSource ? "Source language" : "" }), h("span.gh-name", langs.displayName(lang))]),
            h("span.gh-pct", { class: { done: pct === 100 && stats.total > 0 }, "data-tip": util.formatNumber(filled) + " of " + util.formatNumber(stats.total) + " translated" }, pct + "%"),
            h("button.btn.ghost.icon-only.gh-menu", { type: "button", dataset: { menu: lang }, "aria-label": langs.displayName(lang) + " column options", "aria-haspopup": "menu" }, icon("ellipsis", { size: 15 })),
            h("div.gh-meter", h("i", { style: { width: (stats.total ? (filled / stats.total) * 100 : 0) + "%" } })),
            h("div.col-resize", { dataset: { resize: lang }, "aria-hidden": "true" })
          )
        );
      });

      head.appendChild(
        h("div.gh.gh-add.c-fill", { role: "presentation" }, h("button.btn.ghost.icon-only.sm", { type: "button", dataset: { addlang: "1" }, "data-tip": "Add language", "aria-label": "Add language" }, icon("plus", { size: 15 })))
      );
    }

    function ariaSort(dir) {
      return dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none";
    }

    /** Refresh only the figures in the header (cheap; used after cell edits). */
    function refreshHeadFigures() {
      const p = project();
      if (!p) return;
      const stats = store.stats(p);
      for (const cell of head.querySelectorAll(".gh-lang")) {
        const lang = cell.dataset.lang;
        const filled = stats.filled[lang] || 0;
        const pct = util.completion(filled, stats.total);
        const pctEl = cell.querySelector(".gh-pct");
        if (pctEl) {
          pctEl.textContent = pct + "%";
          pctEl.classList.toggle("done", pct === 100 && stats.total > 0);
          pctEl.dataset.tip = util.formatNumber(filled) + " of " + util.formatNumber(stats.total) + " translated";
        }
        const bar = cell.querySelector(".gh-meter > i");
        if (bar) bar.style.width = (stats.total ? (filled / stats.total) * 100 : 0) + "%";
      }
    }

    /* ---- Cells ------------------------------------------------------------------ */

    function appendHighlighted(parent, text, finder) {
      if (!finder) {
        parent.appendChild(document.createTextNode(text));
        return;
      }
      const pieces = finder.pieces(text);
      for (let i = 0; i < pieces.length; i++) {
        if (!pieces[i]) continue;
        if (i % 2) parent.appendChild(h("mark", pieces[i]));
        else parent.appendChild(document.createTextNode(pieces[i]));
      }
    }

    function fillValueCell(cell, key, lang) {
      const p = project();
      const full = store.getValue(key, lang, p);
      const value = full.length > MAX_CELL_CHARS ? full.slice(0, MAX_CELL_CHARS) + "…" : full;
      LS.dom.clear(cell);
      cell.classList.toggle("missing", !full);
      cell.classList.toggle("busy", !!(o.isBusy && o.isBusy(key, lang)));
      if (!full) {
        cell.appendChild(h("span.cell-empty", { "aria-label": "Empty" }, "—"));
        return;
      }
      const finders = o.getFinder ? o.getFinder() : null;
      const finder = finders && finders.text ? finders.text : null;
      const text = h("span.cell-text");
      for (const tok of LS.text.tokenizeInvisibles(value)) {
        if (tok.t === "text") appendHighlighted(text, tok.v, finder);
        else if (tok.t === "nl") text.append(h("span.inv", { "aria-hidden": "true" }, "↵"), "\n");
        else text.append(h("span.inv", { "aria-hidden": "true" }, "⇥"), "\t");
      }
      cell.appendChild(text);
      const issues = o.getIssues ? o.getIssues(key, lang) : null;
      if (issues && issues.length) {
        cell.appendChild(h("span.cell-flag", { "data-tip": issues.map((x) => x.message).join(" · "), role: "img", "aria-label": "Issue: " + issues.map((x) => x.message).join(", ") }, icon("triangle-alert", { size: 14 })));
      }
    }

    function fillKeyCell(cell, key) {
      const p = project();
      const pinned = p.pinned.includes(key);
      const { ns, leaf } = LS.keys.splitKey(key);
      const finders = o.getFinder ? o.getFinder() : null;
      const finder = finders && finders.keys ? finders.keys : null;
      const nsEl = h("span.key-ns");
      const leafEl = h("span.key-leaf");
      if (finder) {
        // Highlight across the namespace/leaf split.
        const pieces = finder.pieces(key);
        let pos = 0;
        pieces.forEach((piece, i) => {
          if (!piece) return;
          const start = pos;
          pos += piece.length;
          const put = (target, str) => {
            if (!str) return;
            target.appendChild(i % 2 ? h("mark", str) : document.createTextNode(str));
          };
          put(nsEl, piece.slice(0, Math.max(0, ns.length - start)));
          put(leafEl, piece.slice(Math.max(0, ns.length - start)));
        });
      } else {
        nsEl.textContent = ns;
        leafEl.textContent = leaf;
      }
      LS.dom.replaceChildren(
        cell,
        h("span.row-check", ui.checkbox({ checked: selection.has(key), ariaLabel: "Select " + key })),
        pinned ? icon("pin", { size: 13, class: "key-pin" }) : null,
        h("span.key", { title: key }, ns ? nsEl : null, leafEl),
        h(
          "span.row-actions",
          h("button.btn.ghost.icon-only", { type: "button", dataset: { act: "pin" }, "data-tip": pinned ? "Unpin" : "Pin to top", "aria-label": pinned ? "Unpin " + key : "Pin " + key, tabIndex: -1 }, icon(pinned ? "pin-off" : "pin", { size: 14 })),
          h("button.btn.ghost.icon-only", { type: "button", dataset: { act: "more" }, "data-tip": "More", "aria-label": "More actions for " + key, "aria-haspopup": "menu", tabIndex: -1 }, icon("ellipsis", { size: 15 }))
        )
      );
    }

    function buildRow(index) {
      const p = project();
      const key = rows[index];
      const row = h("div.grid-row", { role: "row", "aria-rowindex": String(index + 2), dataset: { key, index: String(index) } });
      row.style.top = index * rowH + "px";
      row.classList.toggle("checked", selection.has(key));
      row.classList.toggle("current", active.key === key);
      row.classList.toggle("pinned-last", pinnedCount > 0 && index === pinnedCount - 1 && rows.length > pinnedCount);

      const keyCell = h("div.gc.gc-key.c-key", { role: "rowheader", id: gid + "-r" + index + "-k" });
      fillKeyCell(keyCell, key);
      if (active.key === key && active.col === KEY_COL) keyCell.classList.add("active");
      row.appendChild(keyCell);

      cols.forEach((lang, i) => {
        const cell = h("div.gc.gc-val.col-" + i, { role: "gridcell", id: gid + "-r" + index + "-c" + i, dataset: { lang }, dir: "auto" });
        const tag = langs.htmlLang(lang);
        if (tag) cell.lang = tag;
        fillValueCell(cell, key, lang);
        if (active.key === key && active.col === lang) cell.classList.add("active");
        row.appendChild(cell);
      });
      row.appendChild(h("div.gc.gc-fill.c-fill", { role: "presentation" }));
      void p;
      return row;
    }

    /* ---- Virtual window ---------------------------------------------------------- */

    function renderWindow() {
      if (destroyed) return;
      const viewH = el.clientHeight || 600;
      const top = el.scrollTop;
      const first = Math.max(0, Math.floor(top / rowH) - OVERSCAN);
      const last = Math.min(rows.length - 1, Math.ceil((top + viewH) / rowH) + OVERSCAN);
      for (const [index, node] of rendered) {
        if (index < first || index > last) {
          node.remove();
          rendered.delete(index);
        }
      }
      for (let i = first; i <= last; i++) {
        if (!rendered.has(i)) {
          const row = buildRow(i);
          rendered.set(i, row);
          body.appendChild(row);
        }
      }
      el.classList.toggle("scrolled-x", el.scrollLeft > 0);
    }

    function scheduleRender() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(renderWindow);
    }

    function resetRows() {
      for (const node of rendered.values()) node.remove();
      rendered.clear();
      body.style.height = rows.length * rowH + "px";
      el.setAttribute("aria-rowcount", String(rows.length + 1));
      renderWindow();
      syncActiveDescendant();
    }

    function rowEl(key) {
      const index = indexOf.get(key);
      return index == null ? null : rendered.get(index) || null;
    }

    function cellEl(key, col) {
      const row = rowEl(key);
      if (!row) return null;
      if (col === KEY_COL) return row.firstElementChild;
      const i = cols.indexOf(col);
      return i === -1 ? null : row.children[i + 1] || null;
    }

    /* ---- Active cell & selection --------------------------------------------------- */

    function syncActiveDescendant() {
      const cell = active.key ? cellEl(active.key, active.col) : null;
      if (cell && cell.id) el.setAttribute("aria-activedescendant", cell.id);
      else el.removeAttribute("aria-activedescendant");
    }

    function setActive(key, col, opts) {
      const so = opts || {};
      const prevKey = active.key;
      const prev = active.key ? cellEl(active.key, active.col) : null;
      if (prev) prev.classList.remove("active");
      if (prevKey && prevKey !== key) {
        const prevRow = rowEl(prevKey);
        if (prevRow) prevRow.classList.remove("current");
      }
      active = { key: key || null, col: key ? col || KEY_COL : null };
      if (active.key) {
        if (so.scroll !== false) ensureVisible(active.key, active.col);
        const row = rowEl(active.key);
        if (row) row.classList.add("current");
        const cell = cellEl(active.key, active.col);
        if (cell) cell.classList.add("active");
      }
      syncActiveDescendant();
      if (!so.silent && o.onActiveChange) o.onActiveChange({ key: active.key, col: active.col });
    }

    function ensureVisible(key, col) {
      const index = indexOf.get(key);
      if (index == null) return;
      const rowTop = index * rowH;
      const viewTop = el.scrollTop;
      const viewH = el.clientHeight;
      if (rowTop < viewTop) el.scrollTop = rowTop;
      else if (rowTop + rowH > viewTop + viewH - HEAD_H) el.scrollTop = rowTop + rowH - viewH + HEAD_H;
      if (col && col !== KEY_COL) {
        const headCell = head.querySelector('.gh-lang[data-lang="' + cssEscape(col) + '"]');
        const keyHead = head.firstElementChild;
        if (headCell && keyHead) {
          const left = headCell.offsetLeft;
          const right = left + headCell.offsetWidth;
          const keyW = keyHead.offsetWidth;
          if (left < el.scrollLeft + keyW) el.scrollLeft = left - keyW;
          else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = Math.min(left - keyW, right - el.clientWidth);
        }
      }
      renderWindow();
    }

    function cssEscape(s) {
      return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, "\\$&");
    }

    function syncSelection() {
      el.classList.toggle("has-selection", selection.size > 0);
      for (const [index, row] of rendered) {
        const key = rows[index];
        const on = selection.has(key);
        row.classList.toggle("checked", on);
        const input = row.querySelector(".row-check input");
        if (input) input.checked = on;
      }
      const headInput = head.querySelector(".head-check input");
      if (headInput) {
        const all = rows.length > 0 && rows.every((k) => selection.has(k));
        headInput.checked = all;
        headInput.indeterminate = !all && rows.some((k) => selection.has(k));
      }
      if (o.onSelectionChange) o.onSelectionChange(selection);
    }

    function toggleRow(key, shift) {
      const index = indexOf.get(key);
      if (index == null) return;
      const turnOn = !selection.has(key);
      if (shift && anchorIndex !== -1 && anchorIndex < rows.length) {
        const from = Math.min(anchorIndex, index);
        const to = Math.max(anchorIndex, index);
        for (let i = from; i <= to; i++) {
          if (turnOn) selection.add(rows[i]);
          else selection.delete(rows[i]);
        }
      } else if (turnOn) selection.add(key);
      else selection.delete(key);
      anchorIndex = index;
      syncSelection();
    }

    /* ---- Editing -------------------------------------------------------------------- */

    function positionEditor() {
      if (!editor) return;
      const index = indexOf.get(editor.key);
      const i = cols.indexOf(editor.lang);
      const headCell = head.children[i + 1];
      if (index == null || i === -1 || !headCell) return cancelEdit();
      const width = Math.max(headCell.offsetWidth + 1, 200);
      const maxLeft = Math.max(0, body.offsetWidth - width);
      editor.el.style.left = Math.min(headCell.offsetLeft - 1, maxLeft) + "px";
      editor.el.style.top = index * rowH - 1 + "px";
      editor.el.style.width = width + "px";
      editor.el.style.minHeight = rowH + 1 + "px";
      sizeEditor();
    }

    function sizeEditor() {
      if (!editor) return;
      const ta = editor.el;
      ta.style.height = "auto";
      ta.style.height = Math.min(260, Math.max(rowH + 1, ta.scrollHeight + 4)) + "px";
    }

    function startEdit(key, lang, opts) {
      const so = opts || {};
      if (editor && editor.key === key && editor.lang === lang) return editor.el.focus();
      commitEdit();
      if (!cols.includes(lang) || !indexOf.has(key)) return;
      setActive(key, lang);
      const original = store.getValue(key, lang);
      const ta = h("textarea.cell-editor", {
        value: so.initial != null ? so.initial : original,
        spellcheck: true,
        rows: 1,
        dir: langs.isRtl(lang) ? "rtl" : "auto",
        "aria-label": key + " — " + langs.displayName(lang),
        autocapitalize: "sentences",
      });
      const tag = langs.htmlLang(lang);
      if (tag) ta.lang = tag;
      editor = { key, lang, el: ta, original };
      body.appendChild(ta);
      positionEditor();
      ta.focus({ preventScroll: true });
      if (so.selectAll) ta.select();
      else ta.setSelectionRange(ta.value.length, ta.value.length);

      ta.addEventListener("input", sizeEditor);
      ta.addEventListener("blur", () => {
        // Defer so that key handlers which move to another cell run first.
        if (editor && editor.el === ta) commitEdit();
      });
      ta.addEventListener("keydown", (e) => {
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          cancelEdit();
          el.focus({ preventScroll: true });
        } else if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
          e.preventDefault();
          const next = neighbour(key, lang, e.metaKey || e.ctrlKey ? 0 : 1, 0);
          commitEdit();
          if (next && next.key !== key) startEdit(next.key, next.col);
          else el.focus({ preventScroll: true });
        } else if (e.key === "Tab") {
          e.preventDefault();
          const next = neighbour(key, lang, 0, e.shiftKey ? -1 : 1, true);
          commitEdit();
          if (next) startEdit(next.key, next.col);
          else el.focus({ preventScroll: true });
        }
        e.stopPropagation();
      });
      if (o.onEditState) o.onEditState(true);
    }

    function commitEdit() {
      if (!editor) return false;
      const { key, lang, el: ta, original } = editor;
      editor = null;
      const value = ta.value;
      ta.remove();
      if (o.onEditState) o.onEditState(false);
      if (value !== original && store.hasKey(key)) {
        o.onCommit(key, lang, value);
        return true;
      }
      return false;
    }

    function cancelEdit() {
      if (!editor) return;
      const ta = editor.el;
      editor = null;
      ta.remove();
      if (o.onEditState) o.onEditState(false);
    }

    /** Cell reached from (key, col) by moving rows/cols; wraps across rows when `wrap` is set. */
    function neighbour(key, col, dRow, dCol, wrap) {
      let r = indexOf.get(key);
      if (r == null) return null;
      const order = [KEY_COL].concat(cols);
      let c = order.indexOf(col);
      if (c === -1) c = 0;
      r += dRow;
      c += dCol;
      if (wrap) {
        if (c >= order.length) {
          c = 1;
          r += 1;
        } else if (c < 1) {
          c = order.length - 1;
          r -= 1;
        }
      }
      if (r < 0 || r >= rows.length) return null;
      c = util.clamp(c, 0, order.length - 1);
      return { key: rows[r], col: order[c] };
    }

    /* ---- Events ---------------------------------------------------------------------- */

    function keyOf(target) {
      const row = target.closest(".grid-row");
      return row ? row.dataset.key : null;
    }

    el.addEventListener("scroll", scheduleRender, { passive: true });

    el.addEventListener("click", (e) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t) return;
      // Header
      const sortBtn = t.closest("[data-sort]");
      if (sortBtn) {
        const col = sortBtn.dataset.sort;
        const id = col === KEY_COL ? "key" : "lang:" + col;
        const v = view();
        if (v.sortBy === id) store.setView({ sortDir: v.sortDir === "asc" ? "desc" : "asc" });
        else store.setView({ sortBy: id, sortDir: "asc" });
        return;
      }
      const menuBtn = t.closest("[data-menu]");
      if (menuBtn) return void (o.onHeaderMenu && o.onHeaderMenu(menuBtn, menuBtn.dataset.menu));
      const addBtn = t.closest("[data-addlang]");
      if (addBtn) return void (o.onAddLanguage && o.onAddLanguage(addBtn));

      // Rows
      const key = keyOf(t);
      if (!key) return;
      if (t.closest(".row-check")) {
        if (t.tagName === "INPUT") toggleRow(key, e.shiftKey);
        return;
      }
      const act = t.closest("[data-act]");
      if (act) {
        if (act.dataset.act === "pin") o.onTogglePin && o.onTogglePin(key);
        else if (o.onRowMenu) o.onRowMenu(act, key, null);
        return;
      }
      const valueCell = t.closest(".gc-val");
      if (valueCell) {
        startEdit(key, valueCell.dataset.lang);
        return;
      }
      if (t.closest(".gc-key")) {
        commitEdit();
        setActive(key, KEY_COL);
        el.focus({ preventScroll: true });
        if (o.onOpenKey) o.onOpenKey(key);
      }
    });

    el.addEventListener("contextmenu", (e) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t || t.closest(".cell-editor")) return;
      const key = keyOf(t);
      if (!key || !o.onRowMenu) return;
      const cell = t.closest(".gc-val");
      commitEdit();
      setActive(key, cell ? cell.dataset.lang : KEY_COL, { scroll: false });
      o.onRowMenu(e, key, cell ? cell.dataset.lang : null);
    });

    el.addEventListener("keydown", (e) => {
      if (e.target !== el || e.isComposing) return;
      const mod = e.metaKey || e.ctrlKey;
      const p = project();
      if (!p || !rows.length) return;
      if (!active.key || !indexOf.has(active.key)) {
        if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Enter", "Home", "End", "PageDown", "PageUp"].includes(e.key)) {
          e.preventDefault();
          setActive(rows[0], cols[0] || KEY_COL);
        }
        return;
      }
      const page = Math.max(1, Math.floor((el.clientHeight - HEAD_H) / rowH) - 1);
      const go = (dRow, dCol) => {
        e.preventDefault();
        const r = util.clamp(indexOf.get(active.key) + dRow, 0, rows.length - 1);
        const next = neighbour(rows[r], active.col, 0, dCol);
        if (next) setActive(next.key, next.col);
      };
      switch (e.key) {
        case "ArrowDown":
          return go(mod ? rows.length : 1, 0);
        case "ArrowUp":
          return go(mod ? -rows.length : -1, 0);
        case "ArrowLeft":
          return go(0, -1);
        case "ArrowRight":
          return go(0, 1);
        case "PageDown":
          return go(page, 0);
        case "PageUp":
          return go(-page, 0);
        case "Home":
          return mod ? go(-rows.length, -cols.length - 1) : go(0, -cols.length - 1);
        case "End":
          return mod ? go(rows.length, cols.length + 1) : go(0, cols.length + 1);
        case "Enter":
        case "F2":
          e.preventDefault();
          if (mod && active.col !== KEY_COL) {
            if (o.onTranslateCell) o.onTranslateCell(active.key, active.col);
          } else if (active.col === KEY_COL) o.onOpenKey && o.onOpenKey(active.key, true);
          else startEdit(active.key, active.col);
          return;
        case " ":
          e.preventDefault();
          toggleRow(active.key, e.shiftKey);
          return;
        case "Escape":
          if (selection.size) {
            e.preventDefault();
            selection = new Set();
            syncSelection();
          }
          return;
        case "Backspace":
        case "Delete":
          e.preventDefault();
          if (active.col === KEY_COL) o.onDeleteKeys && o.onDeleteKeys(selection.size && selection.has(active.key) ? Array.from(selection) : [active.key]);
          else if (store.getValue(active.key, active.col)) o.onCommit(active.key, active.col, "");
          return;
        default:
          break;
      }
      if (mod && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        selection = new Set(rows);
        syncSelection();
      } else if (mod && (e.key === "c" || e.key === "C")) {
        const sel = window.getSelection && String(window.getSelection());
        if (sel) return;
        e.preventDefault();
        if (active.col === KEY_COL) o.onCopy && o.onCopy(active.key, "key");
        else o.onCopy && o.onCopy(store.getValue(active.key, active.col), "text");
      } else if (!mod && !e.altKey && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        o.onTogglePin && o.onTogglePin(active.key);
      }
    });

    // Column resizing
    el.addEventListener("pointerdown", (e) => {
      const handle = e.target instanceof Element ? e.target.closest(".col-resize") : null;
      if (!handle) return;
      e.preventDefault();
      commitEdit();
      const col = handle.dataset.resize;
      const cell = handle.parentElement;
      const startX = e.clientX;
      const startW = cell.getBoundingClientRect().width;
      const min = col === KEY_COL ? KEY_MIN : COL_MIN;
      const max = col === KEY_COL ? KEY_MAX : COL_MAX;
      handle.classList.add("dragging");
      el.classList.add("resizing");
      handle.setPointerCapture(e.pointerId);
      const onMove = (ev) => {
        const w = Math.round(util.clamp(startW + ev.clientX - startX, min, max));
        store.setColumnWidth(col, w);
        columnCSS();
      };
      const onUp = () => {
        handle.classList.remove("dragging");
        el.classList.remove("resizing");
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        scheduleRender();
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });
    el.addEventListener("dblclick", (e) => {
      const handle = e.target instanceof Element ? e.target.closest(".col-resize") : null;
      if (!handle) return;
      const col = handle.dataset.resize;
      store.setColumnWidth(col, col === KEY_COL ? 250 : null);
      columnCSS();
    });

    let lastWidth = 0;
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => {
      const width = el.clientWidth;
      if (width !== lastWidth && (narrow || width < 640)) columnCSS();
      lastWidth = width;
      scheduleRender();
      if (editor) positionEditor();
    }) : null;
    if (resizeObserver) resizeObserver.observe(el);

    /* ---- Public API -------------------------------------------------------------------- */

    const api = {
      el,
      KEY_COL,

      /** Rebuild columns and header from the store's view state. */
      setColumns() {
        const p = project();
        const v = view();
        cols = p ? p.languages.filter((l) => v.visibleLangs.includes(l)) : [];
        if (active.col && active.col !== KEY_COL && !cols.includes(active.col)) active.col = cols[0] || KEY_COL;
        if (editor && !cols.includes(editor.lang)) cancelEdit();
        columnCSS();
        renderHead();
        resetRows();
        if (editor) positionEditor();
      },

      setDensity(density) {
        rowH = ROW_HEIGHTS[density] || ROW_HEIGHTS.compact;
        el.dataset.density = ROW_HEIGHTS[density] ? density : "compact";
        el.style.setProperty("--row-h", rowH + "px");
        resetRows();
        if (editor) positionEditor();
        if (active.key) ensureVisible(active.key, active.col);
      },

      /** Replace the list of keys shown. */
      setRows(nextRows, nextPinnedCount) {
        rows = nextRows;
        pinnedCount = nextPinnedCount || 0;
        indexOf = new Map();
        for (let i = 0; i < rows.length; i++) indexOf.set(rows[i], i);
        let selectionChanged = false;
        for (const k of Array.from(selection)) {
          if (!indexOf.has(k)) {
            selection.delete(k);
            selectionChanged = true;
          }
        }
        anchorIndex = -1;
        if (active.key && !indexOf.has(active.key)) {
          active = { key: null, col: null };
          if (o.onActiveChange) o.onActiveChange({ key: null, col: null });
        }
        if (editor && !indexOf.has(editor.key)) cancelEdit();
        renderHead();
        resetRows();
        if (editor) positionEditor();
        el.classList.toggle("has-selection", selection.size > 0);
        if (selectionChanged && o.onSelectionChange) o.onSelectionChange(selection);
      },

      setEmpty(node) {
        LS.dom.clear(emptySlot);
        emptySlot.hidden = !node;
        if (node) emptySlot.appendChild(node);
      },

      refreshAll() {
        renderHead();
        resetRows();
      },
      refreshHead: renderHead,
      refreshFigures: refreshHeadFigures,

      refreshKey(key) {
        const index = indexOf.get(key);
        if (index == null) return;
        const old = rendered.get(index);
        if (!old) return;
        const fresh = buildRow(index);
        rendered.set(index, fresh);
        old.replaceWith(fresh);
        syncActiveDescendant();
      },

      refreshCell(key, lang) {
        const cell = cellEl(key, lang);
        if (cell) fillValueCell(cell, key, lang);
      },

      flash(cells) {
        for (const c of cells) {
          const cell = cellEl(c.key, c.lang);
          if (!cell) continue;
          cell.classList.remove("flash");
          void cell.offsetWidth;
          cell.classList.add("flash");
          setTimeout(() => cell.classList.remove("flash"), 950);
        }
      },

      getActive: () => ({ key: active.key, col: active.col }),
      setActive,
      startEdit,
      commitEdit,
      cancelEdit,
      isEditing: () => !!editor,
      getRows: () => rows,
      getColumns: () => cols.slice(),
      getSelection: () => new Set(selection),
      setSelection(keys) {
        selection = new Set(keys.filter((k) => indexOf.has(k)));
        syncSelection();
      },
      clearSelection() {
        if (!selection.size) return;
        selection = new Set();
        syncSelection();
      },

      /** Scroll to a key, make it active and briefly highlight it. */
      reveal(key, lang) {
        if (!indexOf.has(key)) return false;
        const col = lang && cols.includes(lang) ? lang : KEY_COL;
        const index = indexOf.get(key);
        const viewH = el.clientHeight;
        // Centre the row when it is far away.
        if (index * rowH < el.scrollTop || index * rowH > el.scrollTop + viewH - HEAD_H - rowH) {
          el.scrollTop = Math.max(0, index * rowH - (viewH - HEAD_H) / 2 + rowH / 2);
        }
        renderWindow();
        setActive(key, col);
        const row = rowEl(key);
        if (row) {
          for (const cell of row.querySelectorAll(".gc-val")) {
            cell.classList.remove("flash");
            void cell.offsetWidth;
            cell.classList.add("flash");
          }
        }
        return true;
      },

      focus() {
        el.focus({ preventScroll: true });
      },

      destroy() {
        destroyed = true;
        cancelAnimationFrame(raf);
        if (resizeObserver) resizeObserver.disconnect();
        cancelEdit();
      },
    };
    return api;
  }

  LS.createGrid = createGrid;
})(globalThis.LS || (globalThis.LS = {}));
