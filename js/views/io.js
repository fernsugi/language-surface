/* Language Surface — import and export dialogs. */
(function (LS) {
  "use strict";

  const h = LS.h;
  const icon = LS.icon;
  const { store, util, ui, langs, importer, exporter } = LS;

  /* ====================================================================== Import */

  let activeImport = null;

  const FORMAT_ICON = { csv: "file-spreadsheet", json: "file-braces", text: "file-text" };
  const FORMAT_LABEL = { csv: "CSV", json: "JSON", text: "Text" };

  const EXAMPLES = [
    { title: "CSV", icon: "file-spreadsheet", code: "key,en,ja\nlp.hello,Hello,こんにちは\nlp.bye,Good Bye,さようなら" },
    { title: "JSON, one file per language", icon: "files", code: '// en.json\n{\n  "lp": { "hello": "Hello" }\n}' },
    { title: "JSON, all languages", icon: "file-braces", code: '{\n  "lp": {\n    "hello": { "en": "Hello", "ja": "こんにちは" }\n  }\n}' },
    { title: "Text, one string per line", icon: "file-text", code: "Hello\nGood Bye\nSee you soon" },
  ];

  function openImport(initialFiles) {
    if (activeImport) {
      if (initialFiles && initialFiles.length) activeImport.add(initialFiles);
      return;
    }
    const current = store.project();
    const state = {
      sources: [],
      target: current ? "current" : "new",
      name: "",
      nameTouched: false,
      mode: "overwrite",
      reading: 0,
    };
    const defaultLang = () => (store.project() ? store.project().sourceLang : "en");

    const fileInput = h("input", { type: "file", multiple: true, accept: ".csv,.tsv,.json,.jsonc,.txt,text/csv,application/json,text/plain", style: "display:none" });
    const content = h("div", { style: "display:flex;flex-direction:column;gap:16px" });
    const importBtn = ui.button({ label: "Import", variant: "primary", disabled: true, onClick: () => apply() });
    const cancelBtn = ui.button({ label: "Cancel", onClick: () => dlg.close(null) });
    const footNote = h("span.foot-start");

    fileInput.addEventListener("change", () => {
      add(Array.from(fileInput.files || []));
      fileInput.value = "";
    });

    async function add(files) {
      if (!files || !files.length) return;
      state.reading += files.length;
      render();
      for (const file of files) {
        let source;
        try {
          if (file.size > 64 * 1024 * 1024) throw new Error("This file is larger than 64 MB.");
          const text = await file.text();
          source = importer.analyzeFile({ name: file.name, text, size: file.size }, { defaultLang: defaultLang() });
        } catch (e) {
          source = { id: util.uid("src"), name: file.name, size: file.size, format: "text", kind: "", error: (e && e.message) || "Could not read this file.", notes: [], keyCount: 0 };
        }
        // The same file dropped twice replaces the earlier copy; different files that merely
        // share a name (en/common.json, ja/common.json) are both kept.
        source.identity = file.name + "|" + file.size + "|" + (file.lastModified || 0);
        state.sources = state.sources.filter((s) => s.identity !== source.identity);
        state.sources.push(source);
        state.reading--;
      }
      if (!state.nameTouched) {
        const first = state.sources.find((s) => !s.error) || state.sources[0];
        const base = first ? first.name.replace(/\.[^.]+$/, "") : "";
        // "en.json" makes a poor project name; fall back to something neutral.
        state.name = base && !langs.inferFromFileName(first.name) ? base : base && state.sources.length === 1 && base.length > 3 ? base : "Imported project";
      }
      render();
    }

    function dropzone(compact) {
      const zone = h(
        "div.dropzone",
        { class: { compact }, role: "button", tabIndex: 0, "aria-label": "Choose files to import" },
        h("div.dropzone-icon", icon("upload", { size: compact ? 15 : 18 })),
        compact
          ? h("div", h("div.dropzone-title", "Add more files"), h("div.dropzone-sub", "Drop them here or click to browse"))
          : [h("div.dropzone-title", "Drop files here, or click to browse"), h("div.dropzone-sub", "CSV, JSON or TXT. Several files can be imported together, for example one JSON per language.")]
      );
      zone.addEventListener("click", () => fileInput.click());
      zone.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          fileInput.click();
        }
      });
      zone.addEventListener("dragover", (e) => {
        e.preventDefault();
        zone.classList.add("over");
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("over"));
      zone.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove("over");
        add(Array.from((e.dataTransfer && e.dataTransfer.files) || []));
      });
      return zone;
    }

    function sourceRow(src) {
      const sub = h("div.file-sub");
      if (src.error) sub.append(src.error);
      else {
        const parts = [FORMAT_LABEL[src.format] || "File"];
        if (src.kind === "multi") parts.push(util.plural(src.langs.length, "language") + " (" + src.langs.map(langs.label).join(", ") + ")");
        if (src.kind === "lines") parts.push(util.plural(src.lines.length, "line"));
        else parts.push(util.plural(src.keyCount, "key"));
        sub.append(parts.join(" · "));
      }

      const controls = h("div.file-controls");
      if (!src.error) {
        if (src.format === "json" && src.multi && src.single) {
          controls.appendChild(
            ui.select({
              size: "sm",
              class: "auto",
              value: src.kind,
              ariaLabel: "How to read " + src.name,
              options: [
                { value: "multi", label: "Several languages" },
                { value: "single", label: "One language" },
              ],
              onChange: (v) => {
                importer.setJSONKind(src, v, defaultLang());
                render();
              },
            })
          );
        }
        if (src.kind === "single" || src.kind === "lines") {
          const langInput = h("input.input.sm.mono.lang-input", {
            type: "text",
            value: src.lang || "",
            placeholder: "lang",
            spellcheck: false,
            autocomplete: "off",
            "aria-label": "Language code for " + src.name,
            "data-tip": "Language of this file",
            onInput: (e) => {
              src.lang = langs.normalize(e.target.value);
              src.langSource = "user";
              renderSummary();
            },
            onBlur: (e) => {
              e.target.value = src.lang || "";
            },
          });
          controls.appendChild(langInput);
        }
        if (src.kind === "lines") {
          controls.appendChild(
            h("input.input.sm.mono", {
              type: "text",
              value: src.prefix || "",
              placeholder: "key prefix",
              style: "width:110px",
              spellcheck: false,
              autocomplete: "off",
              "aria-label": "Key prefix for " + src.name,
              "data-tip": "Keys become prefix_1, prefix_2 … (or 1, 2 … when empty)",
              onInput: (e) => {
                src.prefix = e.target.value.trim();
                renderSummary();
              },
            })
          );
        }
      }
      controls.appendChild(
        ui.button({
          icon: "x",
          variant: "ghost",
          size: "sm",
          tip: "Remove",
          ariaLabel: "Remove " + src.name,
          onClick: () => {
            state.sources = state.sources.filter((s) => s !== src);
            render();
          },
        })
      );

      const notes = (src.notes || []).slice();
      if (!src.error && (src.kind === "single" || src.kind === "lines") && src.langSource === "default") notes.unshift("The language could not be read from the file name, so " + langs.label(src.lang) + " was assumed. Change it if needed.");
      if (!src.error && src.kind === "multi" && src.layout === "lang-first") notes.unshift("Read as a file with languages at the top level.");

      return h(
        "div.file-row",
        { class: { error: !!src.error } },
        h("div.file-row-main", h("div.file-icon", icon(src.error ? "circle-alert" : FORMAT_ICON[src.format] || "file-text", { size: 16 })), h("div.file-meta", h("div.file-name", { title: src.name }, src.name), sub), controls),
        notes.length ? h("div.file-notes", notes.map((n) => h("div", n))) : null
      );
    }

    const summaryEl = h("div.summary");

    function renderSummary() {
      const usable = state.sources.filter((s) => !s.error);
      const plan = importer.buildPlan(usable);
      const p = store.project();
      const toCurrent = state.target === "current" && p;
      LS.dom.clear(summaryEl);
      let ok = usable.length > 0 && plan.keyCount > 0 && !plan.problems.length && !state.reading;

      if (!usable.length) {
        summaryEl.append(h("span", icon("circle-alert", { size: 14 }), "None of these files can be imported."));
      } else if (plan.problems.length) {
        summaryEl.append(h("span", icon("triangle-alert", { size: 14 }), plan.problems[0]));
      } else if (toCurrent) {
        const s = importer.summarize(p, plan, state.mode);
        const bits = [];
        bits.push(h("span", h("b", util.formatNumber(s.newKeys)), s.newKeys === 1 ? "new key" : "new keys"));
        bits.push(h("span", h("b", util.formatNumber(s.filled)), "translations added"));
        if (s.replaced) bits.push(h("span", h("b", util.formatNumber(s.replaced)), "replaced"));
        if (s.kept) bits.push(h("span", h("b", util.formatNumber(s.kept)), "kept as they are"));
        if (s.newLangs.length) bits.push(h("span", "New " + (s.newLangs.length === 1 ? "language" : "languages") + ":", h("b", s.newLangs.map(langs.label).join(", "))));
        summaryEl.append(...bits);
        if (!s.newKeys && !s.filled && !s.replaced && !s.newLangs.length) {
          LS.dom.replaceChildren(summaryEl, h("span", icon("circle-check", { size: 14 }), "Everything in these files is already in the project."));
          ok = false;
        }
      } else {
        summaryEl.append(h("span", h("b", util.formatNumber(plan.keyCount)), plan.keyCount === 1 ? "key" : "keys"), h("span", h("b", String(plan.langs.length)), plan.langs.length === 1 ? "language" : "languages", "(" + plan.langs.map(langs.label).join(", ") + ")"));
      }
      importBtn.disabled = !ok;
      const label = importBtn.querySelector(".btn-label");
      label.textContent = toCurrent ? "Import into " + p.name : "Create project";
      const errors = state.sources.length - usable.length;
      footNote.textContent = state.reading ? "Reading files…" : errors ? util.plural(errors, "file") + " skipped" : "";
    }

    function render() {
      const p = store.project();
      if (!state.sources.length) {
        LS.dom.replaceChildren(
          content,
          dropzone(false),
          state.reading ? h("div.callout", ui.spinner(14), h("div", "Reading files…")) : null,
          h("div", h("div.preview-head", "What you can import"), h("div.format-list", EXAMPLES.map((ex) => h("div.format-example", h("h4", icon(ex.icon, { size: 14 }), ex.title), h("pre", ex.code)))))
        );
        importBtn.disabled = true;
        importBtn.querySelector(".btn-label").textContent = "Import";
        footNote.textContent = "";
        return;
      }

      const nameInput = h("input.input", {
        type: "text",
        value: state.name,
        placeholder: "Project name",
        "aria-label": "New project name",
        onInput: (e) => {
          state.name = e.target.value;
          state.nameTouched = true;
        },
      });
      const destination = ui.segmented({
        value: state.target,
        size: "block",
        ariaLabel: "Destination",
        options: [
          { value: "current", label: p ? "Add to “" + p.name + "”" : "Current project" },
          { value: "new", label: "New project" },
        ],
        onChange: (v) => {
          if (v === "current" && !store.project()) return render();
          state.target = v;
          render();
        },
      });
      const modeSelect = ui.select({
        value: state.mode,
        options: [
          { value: "overwrite", label: "Replace them with the imported text" },
          { value: "keep", label: "Keep them and only fill empty cells" },
        ],
        onChange: (v) => {
          state.mode = v;
          renderSummary();
        },
      });

      LS.dom.replaceChildren(
        content,
        h("div.file-list", state.sources.map(sourceRow)),
        dropzone(true),
        p ? ui.field({ label: "Import into", control: h("div", destination) }) : null,
        state.target === "new" || !p ? ui.field({ label: "Project name", control: nameInput }) : ui.field({ label: "When a translation already exists", control: modeSelect, hint: "Empty cells in the files never erase existing text." }),
        summaryEl
      );
      renderSummary();
    }

    function apply() {
      const usable = state.sources.filter((s) => !s.error);
      const plan = importer.buildPlan(usable);
      if (!plan.keyCount || plan.problems.length) return;
      const p = store.project();
      if (state.target === "current" && p) {
        const res = store.applyImport(plan, state.mode);
        store.setView({ search: "", status: "all", namespace: "" });
        dlg.close(true);
        LS.app.navigate("translations");
        const bits = [];
        if (res.addedKeys) bits.push(util.plural(res.addedKeys, "new key"));
        if (res.changed) bits.push(util.plural(res.changed, "translation") + " updated");
        if (res.addedLangs.length) bits.push("added " + res.addedLangs.map(langs.label).join(", "));
        LS.toast("Import complete", { type: "success", description: bits.join(" · "), action: LS.app.actions.undoAction() });
      } else {
        const created = store.createProject({ name: state.name.trim() || "Imported project", languages: plan.langs, entries: plan.entries, sourceLang: plan.langs[0] });
        store.setUI({ seenWelcome: true });
        dlg.close(true);
        LS.app.navigate("translations");
        LS.toast("Project created", { type: "success", description: created.name + " · " + util.plural(plan.keyCount, "key") + " · " + plan.langs.map(langs.label).join(", ") });
      }
    }

    const dlg = LS.dialog.open({
      title: "Import translations",
      description: "Files are read in your browser. Nothing is uploaded.",
      size: "lg",
      body: [content, fileInput],
      footer: [footNote, cancelBtn, importBtn],
      onClose: () => {
        activeImport = null;
      },
    });
    activeImport = { add };
    render();
    if (initialFiles && initialFiles.length) add(initialFiles);
  }

  /* ====================================================================== Export */

  const FORMATS = [
    { value: "json-per-lang", title: "JSON per language", sub: "One file for each language. What most i18n libraries expect.", icon: "files" },
    { value: "json", title: "Single JSON", sub: "Every language in one file, grouped by key.", icon: "file-braces" },
    { value: "csv", title: "CSV", sub: "A spreadsheet with one column per language.", icon: "file-spreadsheet" },
  ];

  /**
   * @param {{keys?: string[]|null, scoped?: boolean}} [opts] keys of the current view / selection
   */
  function openExport(opts) {
    const o = opts || {};
    const p = store.project();
    if (!p) return;
    const saved = store.state.ui.exportOptions || {};
    const scopedKeys = o.keys && o.keys.length ? o.keys.filter((k) => store.hasKey(k, p)) : null;
    const state = {
      format: FORMATS.some((f) => f.value === saved.format) ? saved.format : "json-per-lang",
      nested: saved.nested !== false,
      sort: saved.sort,
      codeStyle: ["lower", "bcp47", "underscore"].includes(saved.codeStyle) ? saved.codeStyle : "lower",
      naming: saved.naming === "project" ? "project" : "lang",
      delimiter: [",", ";", "\t"].includes(saved.delimiter) ? saved.delimiter : ",",
      bom: !!saved.bom,
      zip: saved.zip !== false,
      langs: new Set(p.languages),
      scope: scopedKeys ? "scoped" : "all",
      previewIndex: 0,
    };
    const total = Object.keys(p.entries).length;

    const options = () => ({
      format: state.format,
      nested: state.nested,
      // CSV was always sorted in the original app; JSON keeps the project's own order unless asked.
      sort: state.sort == null ? state.format === "csv" : !!state.sort,
      codeStyle: state.codeStyle,
      naming: state.naming,
      delimiter: state.delimiter,
      bom: state.bom,
      langs: p.languages.filter((l) => state.langs.has(l)),
      keys: state.scope === "scoped" ? scopedKeys : null,
    });

    const cards = h("div.option-cards", { role: "radiogroup", "aria-label": "Format" });
    const langChips = h("div.chip-set", { role: "group", "aria-label": "Languages" });
    const optionsEl = h("div.form-grid");
    const previewEl = h("pre.code-preview", { tabIndex: 0 });
    const previewTabs = h("div.preview-tabs");
    const previewTitle = h("span", "Preview");
    const notesEl = h("div", { style: "display:flex;flex-direction:column;gap:8px" });
    const footNote = h("span.foot-start");
    const downloadBtn = ui.button({ label: "Download", icon: "download", variant: "primary", onClick: () => download() });

    function renderCards() {
      LS.dom.clear(cards);
      for (const f of FORMATS) {
        const active = state.format === f.value;
        cards.appendChild(
          h(
            "button.option-card",
            {
              type: "button",
              role: "radio",
              "aria-checked": String(active),
              class: { active },
              onClick: () => {
                state.format = f.value;
                state.previewIndex = 0;
                renderAll();
              },
            },
            icon(f.icon, { size: 18 }),
            h("span.option-card-title", f.title),
            h("span.option-card-sub", f.sub)
          )
        );
      }
    }

    function renderLangs() {
      LS.dom.clear(langChips);
      for (const lang of p.languages) {
        const on = state.langs.has(lang);
        langChips.appendChild(
          h(
            "label.chip",
            { class: { on } },
            h("input", {
              type: "checkbox",
              checked: on,
              onChange: (e) => {
                if (e.target.checked) state.langs.add(lang);
                else if (state.langs.size > 1) state.langs.delete(lang);
                state.previewIndex = 0;
                renderLangs();
                renderPreview();
              },
            }),
            on ? icon("check", { size: 13 }) : null,
            h("span", langs.displayName(lang))
          )
        );
      }
    }

    function renderOptions() {
      const isJSON = state.format !== "csv";
      const fields = [];
      if (scopedKeys) {
        fields.push(
          ui.field({
            label: "Keys",
            control: ui.select({
              value: state.scope,
              options: [
                { value: "all", label: "All keys (" + util.formatNumber(total) + ")" },
                { value: "scoped", label: (o.scoped ? "Selected keys (" : "Keys in the current view (") + util.formatNumber(scopedKeys.length) + ")" },
              ],
              onChange: (v) => {
                state.scope = v;
                renderPreview();
              },
            }),
          })
        );
      }
      if (isJSON) {
        fields.push(
          ui.field({
            label: "Key structure",
            control: ui.select({
              value: state.nested ? "nested" : "flat",
              options: [
                { value: "nested", label: 'Nested  { "lp": { "hello": … } }' },
                { value: "flat", label: 'Flat  { "lp.hello": … }' },
              ],
              onChange: (v) => {
                state.nested = v === "nested";
                renderPreview();
              },
            }),
          })
        );
      }
      if (state.format === "json-per-lang") {
        const code = langs.formatCode(p.languages[0], state.codeStyle);
        fields.push(
          ui.field({
            label: "File names",
            control: ui.select({
              value: state.naming,
              options: [
                { value: "lang", label: code + ".json" },
                { value: "project", label: util.safeFileName(p.name) + "_" + code + ".json" },
              ],
              onChange: (v) => {
                state.naming = v;
                renderPreview();
              },
            }),
          })
        );
      }
      if (state.format === "csv") {
        fields.push(
          ui.field({
            label: "Delimiter",
            control: ui.select({
              value: state.delimiter,
              options: [
                { value: ",", label: "Comma  ," },
                { value: ";", label: "Semicolon  ;" },
                { value: "\t", label: "Tab" },
              ],
              onChange: (v) => {
                state.delimiter = v;
                renderPreview();
              },
            }),
          })
        );
      }
      if (p.languages.some((l) => l.includes("-"))) {
        fields.push(
          ui.field({
            label: "Language codes",
            control: ui.select({
              value: state.codeStyle,
              options: [
                { value: "lower", label: "pt-br  (as stored)" },
                { value: "bcp47", label: "pt-BR  (BCP 47)" },
                { value: "underscore", label: "pt_BR  (underscore)" },
              ],
              onChange: (v) => {
                state.codeStyle = v;
                renderOptions();
                renderPreview();
              },
            }),
          })
        );
      }
      const checks = h("div.field.wide", { style: "flex-direction:row;flex-wrap:wrap;gap:8px 20px" });
      checks.appendChild(
        ui.checkbox({
          label: "Sort keys A → Z",
          checked: options().sort,
          onChange: (on) => {
            state.sort = on;
            renderPreview();
          },
        })
      );
      if (state.format === "csv") {
        checks.appendChild(
          ui.checkbox({
            label: "Add a byte-order mark so Excel reads UTF-8",
            checked: state.bom,
            onChange: (on) => {
              state.bom = on;
              renderPreview();
            },
          })
        );
      }
      LS.dom.replaceChildren(optionsEl, fields, checks);
    }

    let built = null;
    function renderPreview() {
      built = exporter.build(p, options());
      const files = built.files;
      state.previewIndex = util.clamp(state.previewIndex, 0, files.length - 1);
      const file = files[state.previewIndex];
      LS.dom.clear(previewTabs);
      if (files.length > 1) {
        files.forEach((f, i) => {
          previewTabs.appendChild(
            h(
              "button.preview-tab",
              {
                type: "button",
                class: { active: i === state.previewIndex },
                onClick: () => {
                  state.previewIndex = i;
                  renderPreview();
                },
              },
              f.name
            )
          );
        });
      }
      previewTitle.textContent = files.length > 1 ? "Preview" : "Preview · " + file.name;
      const lines = util.stripBom(file.content).split("\n");
      previewEl.textContent = lines.slice(0, 40).join("\n") + (lines.length > 40 ? "\n…" : "");

      LS.dom.clear(notesEl);
      if (built.conflicts.length) {
        notesEl.appendChild(
          h(
            "div.callout.warning",
            icon("triangle-alert", { size: 15 }),
            h(
              "div",
              h("strong", util.plural(built.conflicts.length, "key") + " cannot be nested. "),
              "A key that is also a namespace (for example “menu” and “menu.title”) is written with its full name at the top level so nothing is lost: ",
              h("span.mono", built.conflicts.slice(0, 3).join(", ") + (built.conflicts.length > 3 ? "…" : ""))
            )
          )
        );
      }
      const multi = files.length > 1;
      if (multi) {
        notesEl.appendChild(
          ui.checkbox({
            label: "Bundle the " + files.length + " files into one .zip",
            checked: state.zip,
            onChange: (on) => {
              state.zip = on;
              renderPreview();
            },
          })
        );
      }
      footNote.textContent = util.plural(built.keyCount, "key") + " · " + util.plural(built.langs.length, "language");
      downloadBtn.disabled = !built.keyCount;
      downloadBtn.querySelector(".btn-label").textContent = multi ? (state.zip ? "Download " + built.archiveName : "Download " + files.length + " files") : "Download " + file.name;
    }

    function renderAll() {
      renderCards();
      renderLangs();
      renderOptions();
      renderPreview();
    }

    function download() {
      if (!built || !built.keyCount) return;
      const files = built.files;
      if (files.length > 1 && state.zip) {
        const zip = LS.zip.create(files.map((f) => ({ name: f.name, content: f.content })));
        LS.dom.download(built.archiveName, new Blob([zip], { type: "application/zip" }));
      } else {
        files.forEach((f, i) => setTimeout(() => LS.dom.download(f.name, f.content, f.mime), i * 250));
      }
      store.setUI({
        exportOptions: { format: state.format, nested: state.nested, sort: state.sort, codeStyle: state.codeStyle, naming: state.naming, delimiter: state.delimiter, bom: state.bom, zip: state.zip },
      });
      dlg.close(true);
      LS.toast("Export downloaded", { type: "success", description: files.length > 1 ? (state.zip ? built.archiveName : files.length + " files") : files[0].name });
    }

    const dlg = LS.dialog.open({
      title: "Export “" + p.name + "”",
      description: "Download your translations as files you can commit to your project.",
      size: "lg",
      body: [
        cards,
        ui.field({ label: "Languages", control: langChips }),
        optionsEl,
        h("div", h("div.preview-head", previewTitle, previewTabs), previewEl),
        notesEl,
      ],
      footer: [footNote, ui.button({ label: "Cancel", onClick: () => dlg.close(null) }), downloadBtn],
    });
    renderAll();
  }

  LS.importDialog = {
    open: openImport,
    /** Feed files to an already open import dialog. Returns false when none is open. */
    addFiles(files) {
      if (!activeImport) return false;
      activeImport.add(files);
      return true;
    },
  };
  LS.exportDialog = { open: openExport };
})(globalThis.LS || (globalThis.LS = {}));
