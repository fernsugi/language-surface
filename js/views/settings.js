/* Language Surface — Settings page. Every control saves immediately. */
(function (LS) {
  "use strict";

  const h = LS.h;
  const icon = LS.icon;
  const { store, util, ui, ai } = LS;
  const VERSION = "2.0.0";

  function setting(label, desc, control, opts) {
    return h("div.setting", { class: opts && opts.stack ? "stack" : "" }, h("div.setting-text", h("div.setting-label", label), desc ? h("div.setting-desc", desc) : null), h("div.setting-control", control));
  }

  function section(id, title, desc, ...content) {
    return h("section.section", { id: "settings-" + id }, h("div.section-head", h("h3.section-title", title), desc ? h("span.section-desc", desc) : null), ...content);
  }

  function mount(container, params) {
    const sc = LS.shell.scope();
    const page = h("div.page-inner.narrow");
    const scroller = h("div.page", page);
    container.append(LS.shell.topbar({ title: "Settings" }, sc), scroller);
    const s = () => store.state.settings;
    let loadedModels = {};

    /* ---- Appearance & editing ---------------------------------------------------- */

    function appearance() {
      return section(
        "appearance",
        "Appearance",
        "",
        h(
          "div.card",
          setting(
            "Theme",
            "System follows your device setting.",
            ui.segmented({
              value: s().theme,
              ariaLabel: "Theme",
              options: [
                { value: "system", label: "System", icon: "monitor" },
                { value: "light", label: "Light", icon: "sun" },
                { value: "dark", label: "Dark", icon: "moon" },
              ],
              onChange: (v) => store.setSetting("theme", v),
            })
          ),
          setting(
            "Row height",
            "How much of each translation the grid shows.",
            ui.segmented({
              value: s().density,
              ariaLabel: "Row height",
              options: [
                { value: "compact", label: "Compact" },
                { value: "comfortable", label: "Comfortable" },
                { value: "tall", label: "Tall" },
              ],
              onChange: (v) => store.setSetting("density", v),
            })
          ),
          setting(
            "Confirm before deleting",
            "Ask before removing keys. Deletions can always be undone with " + LS.dom.shortcut("mod+Z") + ".",
            ui.toggle({ checked: s().confirmDeletes, ariaLabel: "Confirm before deleting", onChange: (v) => store.setSetting("confirmDeletes", v) })
          )
        )
      );
    }

    /* ---- AI ------------------------------------------------------------------------- */

    const aiSlot = h("div", { style: "display:flex;flex-direction:column;gap:12px" });

    function renderAI() {
      const settings = s().ai;
      const providerId = settings.provider;
      const def = ai.PROVIDERS[providerId];
      const saved = settings.providers[providerId];
      const path = "ai.providers." + providerId + ".";

      const cards = h(
        "div.provider-grid",
        { role: "radiogroup", "aria-label": "AI provider" },
        Object.values(ai.PROVIDERS).map((prov) => {
          const cfg = settings.providers[prov.id];
          const ready = prov.id === "custom" ? !!(cfg.baseUrl && cfg.model) : !!cfg.apiKey;
          return h(
            "button.provider-card",
            {
              type: "button",
              role: "radio",
              "aria-checked": String(prov.id === providerId),
              class: { active: prov.id === providerId },
              onClick: () => {
                store.setSetting("ai.provider", prov.id);
                renderAI();
              },
            },
            h("span.provider-card-name", prov.label, ready ? h("span.dot", { title: "Configured" }) : null),
            h("span.provider-card-sub", prov.blurb)
          );
        })
      );

      const keyInput = h("input.input.mono", {
        type: "password",
        value: saved.apiKey,
        placeholder: def.keyPlaceholder,
        autocomplete: "off",
        spellcheck: false,
        onInput: (e) => {
          store.setSetting(path + "apiKey", e.target.value.trim());
          result.textContent = "";
        },
      });
      const reveal = ui.button({
        icon: "eye",
        tip: "Show or hide the key",
        ariaLabel: "Show or hide the key",
        onClick: () => {
          const show = keyInput.type === "password";
          keyInput.type = show ? "text" : "password";
          LS.dom.replaceChildren(reveal, icon(show ? "eye-off" : "eye", { size: 15 }));
        },
      });

      const listId = "models-" + providerId;
      const modelList = h("datalist", { id: listId }, util.uniq(def.models.concat(loadedModels[providerId] || [])).map((m) => h("option", { value: m })));
      const modelInput = h("input.input.mono", {
        type: "text",
        value: saved.model,
        placeholder: def.defaultModel || "model name",
        autocomplete: "off",
        spellcheck: false,
        attrs: { list: listId },
        onInput: (e) => {
          store.setSetting(path + "model", e.target.value.trim());
          result.textContent = "";
        },
      });
      const loadBtn = ui.button({
        icon: "refresh-cw",
        tip: "Load the model list from the provider",
        ariaLabel: "Load models",
        onClick: async () => {
          ui.setBusy(loadBtn, true);
          try {
            const models = await ai.listModels(s().ai);
            loadedModels[providerId] = models;
            LS.dom.replaceChildren(modelList, util.uniq(def.models.concat(models)).map((m) => h("option", { value: m })));
            show("ok", util.plural(models.length, "model") + " available. Start typing in the Model field to pick one.");
          } catch (e) {
            show("bad", (e && e.message) || "Could not load models.");
          } finally {
            ui.setBusy(loadBtn, false);
          }
        },
      });

      const result = h("div.test-result", { role: "status" });
      const show = (kind, text) => {
        result.className = "test-result " + kind;
        result.textContent = text;
      };
      const testBtn = ui.button({
        label: "Test connection",
        icon: "zap",
        onClick: async () => {
          const problem = ai.configProblem(s().ai);
          if (problem) return show("bad", problem);
          ui.setBusy(testBtn, true);
          show("", "Translating “Hello” into French…");
          const t0 = performance.now();
          try {
            const res = await ai.translate({ ai: s().ai, text: "Hello", sourceLang: "en", targetLang: "fr" });
            show("ok", "It works: “" + res.text + "” (" + Math.round(performance.now() - t0) + " ms)");
            LS.shell.updateSidebar();
          } catch (e) {
            show("bad", (e && e.message) || "The request failed.");
          } finally {
            ui.setBusy(testBtn, false);
          }
        },
      });

      const fields = [];
      if (providerId === "custom") {
        fields.push(
          ui.field({
            class: "wide",
            label: "Base URL",
            hint: "Any server that speaks the OpenAI chat-completions format: a local model (Ollama, LM Studio) or a hosted gateway. The server must allow requests from this page (CORS).",
            control: h("input.input.mono", {
              type: "url",
              value: saved.baseUrl,
              placeholder: def.baseUrlPlaceholder,
              autocomplete: "off",
              spellcheck: false,
              onInput: (e) => {
                store.setSetting(path + "baseUrl", e.target.value.trim());
                result.textContent = "";
              },
            }),
          })
        );
      }
      fields.push(
        ui.field({
          label: "API key",
          optional: !!def.keyOptional,
          control: h("div.key-row", keyInput, reveal),
          hint: def.keyUrl ? h("span", "Create one at ", h("a", { href: def.keyUrl, target: "_blank", rel: "noopener noreferrer" }, new URL(def.keyUrl).hostname), ".") : "Leave empty if your server does not need one.",
        }),
        ui.field({ label: "Model", control: h("div.key-row", modelInput, loadBtn, modelList), hint: "Type any model name your account can use." })
      );

      LS.dom.replaceChildren(
        aiSlot,
        h(
          "div.card",
          h("div.setting.stack", cards, h("div.provider-form", fields), h("div.row", { style: "flex-wrap:wrap" }, testBtn, result))
        ),
        h(
          "div.card",
          setting(
            "Maximum length",
            "Default character limit for AI translations. 0 means no limit. You can change it for each run.",
            h("input.input", {
              type: "number",
              min: "0",
              step: "1",
              value: String(settings.maxChars),
              style: "width:96px",
              "aria-label": "Maximum length",
              onInput: (e) => store.setSetting("ai.maxChars", Math.max(0, Math.floor(Number(e.target.value) || 0))),
            })
          ),
          setting(
            "Parallel requests",
            "How many strings are translated at once. Lower this if you hit rate limits.",
            ui.select({
              class: "auto",
              value: String(settings.concurrency),
              ariaLabel: "Parallel requests",
              options: [1, 2, 3, 4, 6, 8].map((n) => ({ value: String(n), label: String(n) })),
              onChange: (v) => store.setSetting("ai.concurrency", Number(v)),
            })
          )
        ),
        h(
          "div.callout",
          icon("shield-check", { size: 15 }),
          h(
            "div",
            h("strong", "Your key stays here. "),
            "It is saved in this browser only and sent only to the provider you select, straight from this page. It is never included in backups. If you can, use a restricted key with a spending limit."
          )
        )
      );
    }

    /* ---- Data ------------------------------------------------------------------------ */

    const storageDesc = h("span", "Projects are saved in this browser only.");
    const persistSlot = h("span");

    async function refreshStorage() {
      const est = await LS.db.estimate();
      const where = LS.db.mode === "idb" ? "IndexedDB" : LS.db.mode === "local" ? "localStorage" : "memory only — nothing is kept after you close the tab";
      storageDesc.textContent = "Projects are saved in this browser (" + where + ")." + (est.usage != null ? " Currently using " + util.formatBytes(est.usage) + "." : "");
      LS.dom.clear(persistSlot);
      if (est.persisted === true) persistSlot.appendChild(h("span.badge.success", icon("shield-check", { size: 12 }), "Protected"));
      else if (est.persisted === false) {
        persistSlot.appendChild(
          ui.button({
            label: "Protect data",
            tip: "Ask the browser never to clear this site's data automatically",
            onClick: async () => {
              const ok = await LS.db.requestPersistence();
              if (!ok) LS.toast("The browser declined", { description: "Some browsers only allow this for sites you use often or have installed. Keep a backup instead." });
              refreshStorage();
            },
          })
        );
      }
    }

    function data() {
      const restoreInput = h("input", { type: "file", accept: ".json,application/json", style: "display:none" });
      restoreInput.addEventListener("change", async () => {
        const file = restoreInput.files && restoreInput.files[0];
        restoreInput.value = "";
        if (!file) return;
        try {
          const parsed = LS.importer.parseJSON(await file.text(), file.name);
          const res = store.importBackup(parsed);
          if (!res.ok) return LS.toast("Could not restore", { type: "error", description: res.error });
          store.setUI({ seenWelcome: true });
          LS.toast("Backup restored", { type: "success", description: util.plural(res.count, "project") + " added next to your existing ones." });
          LS.app.navigate("translations");
        } catch (e) {
          LS.toast("Could not restore", { type: "error", description: (e && e.message) || "The file could not be read." });
        }
      });

      return section(
        "data",
        "Your data",
        "",
        h(
          "div.card",
          setting("Storage", storageDesc, persistSlot),
          setting(
            "Backup",
            "One file with every project and your preferences. API keys are left out.",
            h(
              "div.row",
              ui.button({
                label: "Download backup",
                icon: "download",
                onClick: () => {
                  const backup = store.exportBackup();
                  const stamp = new Date().toISOString().slice(0, 10);
                  LS.dom.download("language-surface-backup-" + stamp + ".json", JSON.stringify(backup, null, 2) + "\n", "application/json;charset=utf-8");
                  LS.toast("Backup downloaded", { type: "success", description: util.plural(backup.projects.length, "project") });
                },
              }),
              ui.button({ label: "Restore…", icon: "upload", onClick: () => restoreInput.click() }),
              restoreInput
            )
          ),
          setting(
            "Delete everything",
            "Removes every project and setting that Language Surface stored in this browser.",
            ui.button({
              label: "Delete all data",
              variant: "danger",
              onClick: async () => {
                const count = Object.keys(store.state.projects).length;
                const ok = await LS.dialog.confirm({
                  title: "Delete all data?",
                  message: "This removes " + util.plural(count, "project") + ", your API keys and all preferences from this browser. It cannot be undone — download a backup first if you might need it.",
                  confirmLabel: "Delete everything",
                  danger: true,
                });
                if (!ok) return;
                await store.resetAll();
                LS.toast("All data deleted");
                LS.app.navigate("translations");
              },
            })
          )
        )
      );
    }

    /* ---- About ------------------------------------------------------------------------- */

    function about() {
      return section(
        "about",
        "About",
        "",
        h(
          "div.card",
          h(
            "div.setting",
            h("img", { src: "favicon.svg", alt: "", width: 36, height: 36, style: "border-radius:10px" }),
            h(
              "div.setting-text",
              h("div.setting-label", "Language Surface ", h("span.faint.num", { style: "font-weight:400" }, "v" + VERSION)),
              h("div.setting-desc", "A local-first translation manager by fernsugi. No account, no server, no tracking. MIT licensed.")
            ),
            h("div.setting-control", h("a.btn", { href: "https://github.com/fernsugi/language-surface", target: "_blank", rel: "noopener noreferrer" }, h("span.btn-label", "GitHub"), icon("external-link", { size: 13 })))
          )
        )
      );
    }

    LS.dom.replaceChildren(
      page,
      h("div.page-head", h("div.page-head-text", h("h2.page-title", "Settings"), h("p.page-desc", "Preferences apply to every project and are saved as you change them."))),
      appearance(),
      section("ai", "AI translation", "Optional — bring your own key", aiSlot),
      data(),
      section("shortcuts", "Keyboard shortcuts", "", h("div.card", h("div.setting.stack", LS.tools.shortcutList()))),
      about()
    );
    renderAI();
    refreshStorage();

    const goTo = (name) => {
      const target = name ? page.querySelector("#settings-" + name) : null;
      if (target) target.scrollIntoView({ block: "start" });
    };
    if (params && params.section) setTimeout(() => goTo(params.section), 0);

    return {
      update(next) {
        if (next && next.section) goTo(next.section);
      },
      destroy() {
        sc.destroy();
      },
    };
  }

  LS.views.settings = { mount, VERSION };
})(globalThis.LS || (globalThis.LS = {}));
