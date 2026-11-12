/* Language Surface — AI translation flows: quick per-cell translation and the bulk dialog. */
(function (LS) {
  "use strict";

  const h = LS.h;
  const icon = LS.icon;
  const { store, util, ui, langs, ai } = LS;

  const busy = new Set(); // "key\u0000lang" while a cell is being translated
  const busyListeners = new Set();
  const doneListeners = new Set();
  const id = (key, lang) => key + "\u0000" + lang;

  function notify(set, cells) {
    for (const fn of Array.from(set)) {
      try {
        fn(cells);
      } catch (e) {
        console.error(e);
      }
    }
  }

  function setBusy(cells, on) {
    for (const c of cells) {
      if (on) busy.add(id(c.key, c.lang));
      else busy.delete(id(c.key, c.lang));
    }
    notify(busyListeners, cells);
  }

  function providerLine() {
    const cfg = ai.resolveConfig(store.state.settings.ai);
    return cfg.provider.label + (cfg.model ? " · " + cfg.model : "");
  }

  function settingsToast(message) {
    LS.toast("AI translation is not set up", { type: "warning", description: message, action: { label: "Open settings", onClick: () => LS.app.navigate("settings", { section: "ai" }) } });
  }

  /** Build the list of cells to translate. */
  function plan(p, keys, source, targets, mode) {
    const tasks = [];
    let noSource = 0;
    let existing = 0;
    for (const key of keys) {
      if (!store.hasKey(key, p)) continue;
      const text = store.getValue(key, source, p).trim();
      for (const lang of targets) {
        if (lang === source) continue;
        if (!text) {
          noSource++;
          continue;
        }
        if (mode === "missing" && store.getValue(key, lang, p).trim()) {
          existing++;
          continue;
        }
        tasks.push({ key, lang, text });
      }
    }
    return { tasks, noSource, existing };
  }

  /**
   * Run translation tasks, writing each result into the store as it arrives.
   * @returns {Promise<{ok: number, failed: {task, error}[], overLimit: number, aborted: boolean}>}
   */
  async function run(p, source, tasks, opts) {
    const o = opts || {};
    const settings = store.state.settings.ai;
    const controller = o.controller || new AbortController();
    const gate = { until: 0 };
    const group = "ai:" + util.uid("run");
    const projectId = p.id;
    // The project object can be replaced while we wait (another tab saved); always go by id.
    const live = () => {
      const cur = store.project();
      return cur && cur.id === projectId ? cur : null;
    };
    const result = { ok: 0, changed: 0, failed: [], overLimit: 0, aborted: false, cells: [], done: new Set() };
    let done = 0;

    await ai.runQueue(
      tasks,
      async (task) => {
        if (controller.signal.aborted) return;
        const before = live();
        if (!before) return controller.abort(); // the user moved to another project: stop spending requests
        if (o.onStart) o.onStart(task);
        try {
          const res = await ai.withRetry(
            () =>
              ai.translate({
                ai: settings,
                text: task.text,
                sourceLang: source,
                targetLang: task.lang,
                maxChars: o.maxChars,
                glossary: before.glossary,
                context: before.context,
                signal: controller.signal,
              }),
            { signal: controller.signal, gate, onWait: o.onWait }
          );
          const cur = live();
          if (!cur) return controller.abort();
          result.done.add(task);
          // The key or language may have been removed while we waited; only write where it still exists.
          if (store.hasKey(task.key, cur) && cur.languages.includes(task.lang)) {
            const changed = store.setValue(task.key, task.lang, res.text, { group, label: "AI translate" });
            result.ok++;
            if (changed) {
              result.changed++;
              result.cells.push({ key: task.key, lang: task.lang });
            }
            if (res.overLimit) result.overLimit++;
          }
        } catch (e) {
          const err = e instanceof ai.AIError ? e : new ai.AIError("request", (e && e.message) || String(e));
          if (err.kind === "aborted") return;
          result.failed.push({ task, error: err });
          if (err.fatal) controller.abort();
        }
        done++;
        if (o.onProgress) o.onProgress(done, tasks.length, result);
      },
      { concurrency: settings.concurrency, signal: controller.signal }
    );
    result.aborted = controller.signal.aborted;
    return result;
  }

  /** Translate a handful of cells in place, without a dialog. */
  async function translateCells(keys, targets) {
    const p = store.project();
    if (!p) return;
    const problem = ai.configProblem(store.state.settings.ai);
    if (problem) return settingsToast(problem);
    const source = p.sourceLang;
    const { tasks, noSource } = plan(p, keys, source, targets, "all");
    if (!tasks.length) {
      return LS.toast("Nothing to translate", { description: noSource ? "The " + langs.label(source) + " source text is empty." : "Pick a language other than the source." });
    }
    if (tasks.length > 12) return openDialog({ keys, targets, scope: "selected" });

    const cells = tasks.filter((t) => !busy.has(id(t.key, t.lang)));
    if (!cells.length) return;
    setBusy(cells, true);
    let result;
    try {
      result = await run(p, source, cells, { maxChars: store.state.settings.ai.maxChars });
    } finally {
      setBusy(cells, false);
    }
    if (result.cells.length) notify(doneListeners, result.cells);
    if (result.failed.length) {
      const first = result.failed[0].error;
      if (first.kind === "config" || first.kind === "auth") settingsToast(first.message);
      else LS.toast(result.failed.length === 1 ? "Translation failed" : util.plural(result.failed.length, "translation") + " failed", { type: "error", description: first.message });
    } else if (result.overLimit) {
      LS.toast("Translated, but longer than the limit", { type: "warning", description: util.plural(result.overLimit, "result") + " exceed the maximum length." });
    }
  }

  /* ---- Bulk dialog ---------------------------------------------------------------------- */

  /**
   * @param {{keys?: string[], scope?: "view"|"selected", targets?: string[]}} [opts]
   */
  function openDialog(opts) {
    const o = opts || {};
    const p = store.project();
    if (!p) return;
    if (p.languages.length < 2) {
      return LS.toast("Add a second language first", { description: "AI translation needs a source and at least one target language.", action: { label: "Languages", onClick: () => LS.app.navigate("languages") } });
    }

    const allKeys = Object.keys(p.entries);
    const scoped = o.keys && o.keys.length ? o.keys.filter((k) => store.hasKey(k, p)) : null;
    const state = {
      source: p.sourceLang,
      targets: new Set((o.targets && o.targets.length ? o.targets : p.languages).filter((l) => l !== p.sourceLang && p.languages.includes(l))),
      scope: scoped ? "scoped" : "all",
      mode: "missing",
      maxChars: store.state.settings.ai.maxChars || 0,
    };
    let dlg = null;
    let controller = null;

    const projectId = p.id;
    const liveProject = () => {
      const cur = store.project();
      return cur && cur.id === projectId ? cur : null;
    };
    const keysInScope = () => (state.scope === "scoped" && scoped ? scoped : Object.keys((liveProject() || p).entries));
    const currentPlan = () => plan(liveProject() || p, keysInScope(), state.source, Array.from(state.targets), state.mode);

    /* -- configure -- */
    const summary = h("div.summary");
    const targetChips = h("div.chip-set", { role: "group", "aria-label": "Target languages" });
    const startBtn = ui.button({ label: "Translate", icon: "sparkles", variant: "primary", onClick: () => start() });
    const cancelBtn = ui.button({ label: "Cancel", onClick: () => dlg.close(null) });

    function renderTargets() {
      const stats = store.stats(p);
      LS.dom.clear(targetChips);
      for (const lang of p.languages) {
        if (lang === state.source) continue;
        const on = state.targets.has(lang);
        targetChips.appendChild(
          h(
            "label.chip",
            { class: { on }, title: langs.displayName(lang) },
            h("input", {
              type: "checkbox",
              checked: on,
              onChange: (e) => {
                if (e.target.checked) state.targets.add(lang);
                else state.targets.delete(lang);
                renderTargets();
                renderSummary();
              },
            }),
            on ? icon("check", { size: 13 }) : null,
            h("span", langs.displayName(lang)),
            h("span.num", { style: "opacity:.7" }, util.completion(stats.filled[lang] || 0, stats.total) + "%")
          )
        );
      }
    }

    function renderSummary() {
      const pl = currentPlan();
      const problem = ai.configProblem(store.state.settings.ai);
      LS.dom.replaceChildren(
        summary,
        h("span", icon("sparkles", { size: 14 }), h("b", util.formatNumber(pl.tasks.length)), pl.tasks.length === 1 ? "string to translate" : "strings to translate"),
        pl.existing ? h("span", h("b", util.formatNumber(pl.existing)), "already translated (kept)") : null,
        pl.noSource ? h("span", h("b", util.formatNumber(pl.noSource)), "without source text (skipped)") : null
      );
      startBtn.disabled = !pl.tasks.length || !!problem;
      const label = startBtn.querySelector(".btn-label");
      if (label) label.textContent = pl.tasks.length ? "Translate " + util.plural(pl.tasks.length, "string") : "Translate";
    }

    function configBody() {
      const problem = ai.configProblem(store.state.settings.ai);
      const sourceSelect = ui.select({
        value: state.source,
        options: p.languages.map((l) => ({ value: l, label: langs.displayName(l) + " (" + langs.label(l) + ")" })),
        onChange: (v) => {
          state.source = v;
          state.targets.delete(v);
          if (!state.targets.size) p.languages.filter((l) => l !== v).forEach((l) => state.targets.add(l));
          renderTargets();
          renderSummary();
        },
      });
      const scopeOptions = [{ value: "all", label: "All keys (" + util.formatNumber(allKeys.length) + ")" }];
      if (scoped) scopeOptions.push({ value: "scoped", label: (o.scope === "selected" ? "Selected keys (" : "Keys in the current view (") + util.formatNumber(scoped.length) + ")" });
      const scopeSelect = ui.select({
        value: state.scope,
        options: scopeOptions,
        onChange: (v) => {
          state.scope = v;
          renderSummary();
        },
      });
      const mode = ui.segmented({
        value: state.mode,
        size: "block",
        ariaLabel: "What to translate",
        options: [
          { value: "missing", label: "Fill empty translations" },
          { value: "all", label: "Retranslate everything" },
        ],
        onChange: (v) => {
          state.mode = v;
          renderSummary();
          overwriteNote.hidden = v !== "all";
        },
      });
      const overwriteNote = h("div.callout.warning", { hidden: true }, icon("triangle-alert", { size: 15 }), h("div", "Existing translations in the selected languages will be replaced. You can undo the whole run afterwards."));
      const maxInput = h("input.input", {
        type: "number",
        min: "0",
        step: "1",
        value: String(state.maxChars),
        onInput: (e) => {
          state.maxChars = Math.max(0, Math.floor(Number(e.target.value) || 0));
        },
      });
      renderTargets();
      renderSummary();

      return [
        problem
          ? h(
              "div.callout.warning",
              icon("key-round", { size: 15 }),
              h("div", h("strong", "AI translation is not set up. "), problem + " "),
              ui.button({
                label: "Open settings",
                size: "sm",
                onClick: () => {
                  dlg.close(null);
                  LS.app.navigate("settings", { section: "ai" });
                },
              })
            )
          : null,
        h("div.form-grid", ui.field({ label: "Translate from", control: sourceSelect }), ui.field({ label: "Keys", control: scopeSelect })),
        ui.field({ label: "Into", control: targetChips }),
        ui.field({ label: "What to translate", control: h("div", mode) }),
        overwriteNote,
        ui.field({ label: "Maximum length", control: maxInput, hint: "Characters per translation. 0 means no limit." , class: "half" }),
        summary,
      ];
    }

    /* -- run -- */
    /** @param {Array} [retryTasks] tasks from an earlier attempt that still need doing */
    async function start(retryTasks) {
      const project = liveProject();
      if (!project) return dlg.close(null, true);
      const tasks = retryTasks || currentPlan().tasks;
      if (!tasks.length) return;
      controller = new AbortController();

      const pctEl = h("span.run-pct", "0%");
      const ofEl = h("span.run-of", "0 of " + util.formatNumber(tasks.length));
      const meter = ui.meter(0, tasks.length, { label: "Translation progress" });
      const fill = meter.firstElementChild;
      const statusEl = h("div.run-status", ui.spinner(14), h("span.truncate", "Starting…"));
      const countsEl = h("div.run-counts");
      const setStatus = (text, warn) => {
        statusEl.classList.toggle("warn", !!warn);
        LS.dom.replaceChildren(statusEl, warn ? icon("triangle-alert", { size: 14 }) : ui.spinner(14), h("span.truncate", text));
      };
      const setCounts = (r) => {
        LS.dom.replaceChildren(countsEl, h("span", h("b", util.formatNumber(r.ok)), " translated"), r.failed.length ? h("span", h("b", util.formatNumber(r.failed.length)), " failed") : null);
      };
      setCounts({ ok: 0, failed: [] });

      const stopBtn = ui.button({
        label: "Stop",
        onClick: () => {
          stopBtn.disabled = true;
          setStatus("Stopping after the requests in flight…");
          controller.abort();
        },
      });
      LS.dom.replaceChildren(
        dlg.body,
        h(
          "div.run",
          h("div.run-figure", pctEl, ofEl),
          meter,
          statusEl,
          countsEl,
          h("div.callout", icon("info", { size: 15 }), h("div", "Keep this tab open. Every translation is saved as soon as it arrives, so stopping never loses finished work."))
        )
      );
      LS.dom.replaceChildren(dlg.footer, h("span.foot-start", providerLine()), stopBtn);
      dlg.lock(true);

      const result = await run(project, state.source, tasks, {
        controller,
        maxChars: state.maxChars,
        onStart: (task) => setStatus(task.key + " → " + langs.label(task.lang)),
        onWait: (info) => setStatus((info.error.kind === "rate" ? "Rate limited" : "Connection problem") + " — retrying in " + Math.ceil(info.waitMs / 1000) + "s (attempt " + info.attempt + " of " + info.retries + ")", true),
        onProgress: (done, total, r) => {
          const pct = Math.round((done / total) * 100);
          pctEl.textContent = pct + "%";
          ofEl.textContent = util.formatNumber(done) + " of " + util.formatNumber(total);
          fill.style.width = pct + "%";
          meter.setAttribute("aria-valuenow", String(pct));
          setCounts(r);
        },
      });
      dlg.lock(false);
      if (result.cells.length) notify(doneListeners, result.cells);
      showResult(result, tasks);
    }

    function showResult(result, tasks) {
      const leftover = tasks.filter((t) => !result.done.has(t));
      const remaining = leftover.length - result.failed.length;
      // Bound to this run: if the run changed nothing there is nothing to undo, and the button
      // must never fall through to an earlier, unrelated change.
      const undoToken = result.changed ? store.undoToken() : null;
      const allGood = !result.failed.length && !result.aborted;
      const fatal = result.failed.find((f) => f.error.fatal);
      const title = allGood ? "Translation complete" : result.aborted && !fatal ? "Translation stopped" : "Finished with problems";
      const body = [
        h(
          "div.callout",
          { class: allGood ? "accent" : fatal ? "danger" : "warning" },
          icon(allGood ? "circle-check" : "triangle-alert", { size: 16 }),
          h(
            "div",
            h("strong", title + ". "),
            util.plural(result.ok, "string") + " translated" + (result.failed.length ? ", " + result.failed.length + " failed" : "") + (remaining > 0 ? ", " + remaining + " not attempted" : "") + "."
          )
        ),
      ];
      if (fatal) body.push(h("p.dialog-text", fatal.error.message));
      if (result.overLimit) body.push(h("div.callout.warning", icon("triangle-alert", { size: 15 }), h("div", util.plural(result.overLimit, "translation") + " came back longer than the " + state.maxChars + "-character limit. Use the Issues filter or shorten them by hand.")));
      const others = result.failed.filter((f) => !f.error.fatal);
      if (others.length) {
        body.push(
          h(
            "div.fail-list",
            others.slice(0, 50).map((f) => h("div.fail-row", h("span.mono", { title: f.task.key }, f.task.key + " → " + langs.label(f.task.lang)), h("span", f.error.message))),
            others.length > 50 ? h("div.fail-row", h("span", "…and " + (others.length - 50) + " more")) : null
          )
        );
      }
      LS.dom.replaceChildren(dlg.body, body);

      const foot = [h("span.foot-start", providerLine())];
      if (undoToken) {
        foot.push(
          ui.button({
            label: "Undo run",
            icon: "undo-2",
            onClick: () => {
              const undone = store.undoIfLatest(undoToken);
              dlg.close(null);
              if (undone) LS.toast("AI translations removed", { duration: 2200 });
              else LS.toast("Other changes came after this run", { description: "Use " + LS.dom.shortcut("mod+Z") + " to step back through recent changes." });
            },
          })
        );
      }
      if (fatal) {
        foot.push(
          ui.button({
            label: "Open settings",
            onClick: () => {
              dlg.close(null);
              LS.app.navigate("settings", { section: "ai" });
            },
          })
        );
      } else if (leftover.length) {
        foot.push(
          ui.button({
            label: "Retry " + util.formatNumber(leftover.length) + " remaining",
            icon: "refresh-cw",
            onClick: () => start(leftover),
          })
        );
      }
      foot.push(ui.button({ label: "Done", variant: "primary", attrs: { autofocus: true }, onClick: () => dlg.close(null) }));
      LS.dom.replaceChildren(dlg.footer, foot);
      const done = dlg.footer.querySelector("[autofocus]");
      if (done) done.focus();
    }

    let locked = false;
    dlg = LS.dialog.open({
      title: "Translate with AI",
      description: "Uses your own API key. Text is sent directly from this browser to the provider.",
      body: configBody(),
      footer: [h("span.foot-start", providerLine()), cancelBtn, startBtn],
      size: "lg",
      beforeClose: () => !locked,
    });
    dlg.lock = (on) => {
      locked = !!on;
      const x = dlg.el.querySelector(".dialog-close");
      if (x) x.hidden = locked;
    };
    return dlg;
  }

  LS.translator = {
    isBusy: (key, lang) => busy.has(id(key, lang)),
    onBusy(fn) {
      busyListeners.add(fn);
      return () => busyListeners.delete(fn);
    },
    onDone(fn) {
      doneListeners.add(fn);
      return () => doneListeners.delete(fn);
    },
    translateCells,
    openDialog,
    plan,
  };
})(globalThis.LS || (globalThis.LS = {}));
