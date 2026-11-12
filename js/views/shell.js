/* Language Surface — application shell: sidebar, routing, theme, global shortcuts. */
(function (LS) {
  "use strict";

  const h = LS.h;
  const icon = LS.icon;
  const { store, util, ui, overlay } = LS;

  const VIEWS = ["translations", "languages", "glossary", "settings"];
  const NAV = [
    { name: "translations", label: "Translations", icon: "table-2" },
    { name: "languages", label: "Languages", icon: "globe" },
    { name: "glossary", label: "Glossary", icon: "book-a" },
  ];

  let root = null;
  let viewEl = null;
  let sidebarEl = null;
  let current = null; // { name, instance }
  const nsOpen = new Map(); // projectId -> Set of expanded namespace paths

  /**
   * Collects listeners so a view can release everything with one call, and remembers which
   * project the view was opened for: `alive()` turns false once another project is current, so
   * late blur handlers and timers can never write one project's text into another.
   */
  function scope() {
    const disposers = [];
    const projectId = store.project() ? store.project().id : null;
    return {
      projectId,
      alive() {
        const p = store.project();
        return !!p && p.id === projectId;
      },
      on(type, fn) {
        disposers.push(store.on(type, fn));
      },
      listen(target, type, fn, opts) {
        target.addEventListener(type, fn, opts);
        disposers.push(() => target.removeEventListener(type, fn, opts));
      },
      add(fn) {
        disposers.push(fn);
      },
      destroy() {
        while (disposers.length) {
          try {
            disposers.pop()();
          } catch (e) {
            console.error(e);
          }
        }
      },
    };
  }

  /* ---- Theme -------------------------------------------------------------------- */

  const darkQuery = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;

  function resolvedTheme() {
    const pref = store.state.settings.theme;
    if (pref === "dark" || pref === "light") return pref;
    return darkQuery && darkQuery.matches ? "dark" : "light";
  }

  function applyTheme() {
    const theme = resolvedTheme();
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#0b0e10" : "#f4f6f8");
  }

  /* ---- Routing ------------------------------------------------------------------ */

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, "");
    const [path, query] = raw.split("?");
    const seg = path.split("/");
    let name = seg[0] || "translations";
    const params = {};
    new URLSearchParams(query || "").forEach((v, k) => (params[k] = v));
    // Routes of the original app keep working: #list, #edit/<key>, #settings, #welcome
    if (name === "list" || name === "welcome") name = "translations";
    if (name === "edit") {
      try {
        params.key = decodeURIComponent(seg.slice(1).join("/"));
      } catch (e) {
        params.key = seg.slice(1).join("/");
      }
      name = "translations";
    }
    if (!VIEWS.includes(name)) name = "translations";
    return { name, params };
  }

  function navigate(name, params) {
    const q = params ? new URLSearchParams(params).toString() : "";
    const next = "#/" + name + (q ? "?" + q : "");
    if (location.hash === next) renderView();
    else location.hash = next;
    closeDrawer();
  }

  function renderView(force) {
    const route = parseHash();
    let name = route.name;
    if (!store.project() && name !== "settings") name = "welcome";
    if (current && current.name === name && !force) {
      if (current.instance && current.instance.update) current.instance.update(route.params);
      updateSidebar();
      return;
    }
    teardown();
    root.dataset.view = name;
    const view = LS.views[name];
    current = { name, instance: view.mount(viewEl, route.params) || null };
    updateSidebar();
  }

  /** Close the current view, letting it save what the user was in the middle of. */
  function teardown() {
    const instance = current && current.instance;
    current = null;
    if (instance && instance.destroy) {
      try {
        instance.destroy();
      } catch (e) {
        console.error(e);
      }
    }
    overlay.closeAll();
    if (viewEl) LS.dom.clear(viewEl);
  }

  /** Commit whatever is being typed (open cell editor, details panel, instructions box). */
  function flushView() {
    const instance = current && current.instance;
    if (instance && instance.flush) {
      try {
        instance.flush();
      } catch (e) {
        console.error(e);
      }
    }
  }

  /* ---- Sidebar ------------------------------------------------------------------- */

  function initials(name) {
    const words = String(name || "?").trim().split(/[\s_\-.]+/).filter(Boolean);
    const chars = words.length > 1 ? Array.from(words[0])[0] + Array.from(words[1])[0] : Array.from(words[0] || "?").slice(0, 2).join("");
    return chars.toUpperCase();
  }

  function hueOf(str) {
    let n = 0;
    for (let i = 0; i < str.length; i++) n = (n * 31 + str.charCodeAt(i)) % 360;
    return n;
  }

  function avatar(p, small) {
    return h("span.project-avatar", { class: small ? "sm" : "", style: { background: "oklch(0.52 0.1 " + hueOf(p.id) + ")", color: "#fff" }, "aria-hidden": "true" }, initials(p.name));
  }

  function projectSummary(p) {
    const s = store.stats(p);
    return util.plural(s.total, "key") + " · " + util.plural(p.languages.length, "language");
  }

  function isNarrow() {
    return window.innerWidth <= 860;
  }

  function setSidebar(open) {
    if (isNarrow()) {
      root.dataset.drawer = open ? "open" : "closed";
      return;
    }
    store.setUI({ sidebarCollapsed: !open });
    root.dataset.sidebar = open ? "open" : "closed";
  }

  function closeDrawer() {
    if (root) root.dataset.drawer = "closed";
  }

  function sidebarIsOpen() {
    return isNarrow() ? root.dataset.drawer === "open" : root.dataset.sidebar !== "closed";
  }

  function buildSidebar() {
    sidebarEl = h("aside.sidebar", { "aria-label": "Sidebar" });
    updateSidebar();
    return sidebarEl;
  }

  const refreshSidebarSoon = util.debounce(() => updateSidebar(), 120);

  function updateSidebar() {
    if (!sidebarEl) return;
    const p = store.project();
    const route = current ? current.name : parseHash().name;
    const stats = p ? store.stats(p) : null;

    const switcher = h(
      "button.project-switcher",
      {
        type: "button",
        "aria-haspopup": "menu",
        onClick: (e) => overlay.toggle(e.currentTarget, () => LS.pickers.projects(e.currentTarget)),
      },
      p ? avatar(p) : h("span.project-avatar", icon("folder", { size: 14 })),
      h("span.project-switcher-text", h("div.project-switcher-name", p ? p.name : "No project"), h("div.project-switcher-sub", p ? projectSummary(p) : "Create or import one")),
      icon("chevrons-up-down", { size: 14 })
    );

    const counts = p ? { translations: stats.total, languages: p.languages.length, glossary: p.glossary.length } : {};
    const nav = h(
      "nav.nav",
      { "aria-label": "Project" },
      NAV.map((item) =>
        h(
          "a.nav-item",
          {
            href: "#/" + item.name,
            class: { active: route === item.name },
            "aria-current": route === item.name ? "page" : null,
            "aria-disabled": p ? null : "true",
            onClick: (e) => {
              if (!p) e.preventDefault();
              closeDrawer();
            },
          },
          icon(item.icon, { size: 16 }),
          h("span", item.label),
          p ? h("span.count", util.formatNumber(counts[item.name])) : null
        )
      )
    );

    const aiReady = !LS.ai.configProblem(store.state.settings.ai);
    const foot = h(
      "div.sidebar-foot",
      h(
        "a.nav-item",
        { href: "#/settings", class: { active: route === "settings" }, "aria-current": route === "settings" ? "page" : null, onClick: closeDrawer },
        icon("settings", { size: 16 }),
        h("span", "Settings"),
        !aiReady && p ? h("span.nav-dot", { "data-tip": "AI translation is not set up yet", "data-tip-side": "right" }) : null
      ),
      saveStateEl()
    );

    LS.dom.replaceChildren(
      sidebarEl,
      h(
        "div.sidebar-head",
        h("img.brand-mark", { src: "favicon.svg", alt: "", width: 22, height: 22 }),
        h("span.brand-name", "Language Surface"),
        ui.button({ icon: "panel-left", variant: "ghost", size: "sm", tip: "Hide sidebar", tipKbd: "mod+B", onClick: () => setSidebar(false) })
      ),
      switcher,
      nav,
      p ? namespaceSection(p) : null,
      foot
    );
  }

  function saveStateEl() {
    const status = store.saveStatus;
    if (LS.db.mode === "memory") {
      return h("div.save-state.warn", { "data-tip": "This browser is blocking storage, so changes are lost when the tab closes. Export your work.", "data-tip-side": "right" }, icon("triangle-alert", { size: 14 }), h("span", "Not saved — storage blocked"));
    }
    if (status === "error") {
      return h("button.save-state.error", { type: "button", onClick: () => store.flush(), "data-tip": "Click to retry", "data-tip-side": "right" }, icon("circle-alert", { size: 14 }), h("span", "Couldn’t save — retry"));
    }
    if (status === "saving") return h("div.save-state.saving", icon("loader-circle", { size: 14, class: "spin" }), h("span", "Saving…"));
    return h("div.save-state", { "data-tip": "Everything is stored in this browser only", "data-tip-side": "right" }, icon("circle-check", { size: 14 }), h("span", "Saved on this device"));
  }

  function namespaceSection(p) {
    const tree = LS.keys.namespaceTree(Object.keys(p.entries));
    if (!tree.children.length) return h("div.sidebar-section");
    const open = nsOpen.get(p.id) || nsOpen.set(p.id, new Set()).get(p.id);
    const active = store.view().namespace || "";
    // Reveal the active namespace.
    if (active) {
      const parts = active.split(".");
      for (let i = 1; i < parts.length; i++) open.add(parts.slice(0, i).join("."));
    }
    const list = h("div.ns-tree", { role: "tree", "aria-label": "Namespaces" });

    const pick = (path) => {
      store.setView({ namespace: path });
      if (!current || current.name !== "translations") navigate("translations");
      else closeDrawer();
      updateSidebar();
    };

    list.appendChild(
      h(
        "button.ns-item.all",
        { type: "button", role: "treeitem", class: { active: !active }, onClick: () => pick("") },
        h("span.ns-twist.leaf"),
        h("span.ns-name", "All keys"),
        h("span.count", util.formatNumber(tree.count))
      )
    );

    const addNodes = (nodes, depth) => {
      for (const node of nodes) {
        const expandable = node.children.length > 0;
        const isOpen = open.has(node.path);
        const twist = h(
          "span.ns-twist",
          {
            class: { open: isOpen, leaf: !expandable },
            onClick: (e) => {
              e.stopPropagation();
              if (isOpen) open.delete(node.path);
              else open.add(node.path);
              updateSidebar();
            },
          },
          icon("chevron-right", { size: 12 })
        );
        list.appendChild(
          h(
            "button.ns-item",
            {
              type: "button",
              role: "treeitem",
              "aria-expanded": expandable ? String(isOpen) : null,
              class: { active: active === node.path },
              style: { "--depth": depth },
              title: node.path,
              onClick: () => pick(node.path),
            },
            twist,
            h("span.ns-name", node.name),
            h("span.count", util.formatNumber(node.count))
          )
        );
        if (expandable && isOpen) addNodes(node.children, depth + 1);
      }
    };
    addNodes(tree.children, 0);
    return h("div.sidebar-section", h("div.sidebar-section-title", "Namespaces"), list);
  }

  /* ---- Topbar helpers -------------------------------------------------------------- */

  /**
   * Standard top bar. Views pass their own title area and actions.
   * @param {{title?: Node|string, crumb?: boolean, actions?: Node[]}} o
   * @param {{on: Function}} sc scope used to keep undo/redo state fresh
   */
  function topbar(o, sc) {
    const p = store.project();
    const menuBtn = ui.button({ icon: "panel-left", variant: "ghost", tip: "Show sidebar", tipKbd: "mod+B", class: "sidebar-open-btn", onClick: () => setSidebar(true) });
    const syncMenuBtn = () => {
      menuBtn.hidden = !isNarrow() && root.dataset.sidebar !== "closed";
    };
    syncMenuBtn();
    sc.on("ui", syncMenuBtn);
    sc.listen(window, "resize", syncMenuBtn);

    const undoBtn = ui.button({ icon: "undo-2", variant: "ghost", tip: "Undo", tipKbd: "mod+Z", class: "hide-narrow", onClick: () => actions.undo() });
    const redoBtn = ui.button({ icon: "redo-2", variant: "ghost", tip: "Redo", tipKbd: "shift+mod+Z", class: "hide-narrow", onClick: () => actions.redo() });
    const syncHistory = () => {
      undoBtn.disabled = !store.canUndo();
      redoBtn.disabled = !store.canRedo();
    };
    syncHistory();
    sc.on("history", syncHistory);

    const palette = h(
      "button.palette-trigger.hide-narrow",
      { type: "button", onClick: () => actions.palette(), "aria-label": "Search and commands" },
      icon("search", { size: 14 }),
      h("span", "Search"),
      ui.kbd("mod+K")
    );
    const paletteNarrow = ui.button({ icon: "search", variant: "ghost", class: "only-narrow", ariaLabel: "Search and commands", onClick: () => actions.palette() });

    const title = h("div.topbar-title");
    if (o.crumb && p) title.append(h("span.topbar-crumb.hide-narrow", p.name), icon("chevron-right", { size: 14, class: "topbar-sep hide-narrow" }));
    if (typeof o.title === "string") {
      if (o.title) title.append(h("h1", o.title));
    } else if (o.title) title.append(...[].concat(o.title));

    return h(
      "header.topbar",
      menuBtn,
      title,
      h("div.topbar-actions", p ? [undoBtn, redoBtn] : null, palette, paletteNarrow, o.actions && o.actions.length ? [h("span.topbar-divider.hide-narrow"), o.actions] : null)
    );
  }

  /* ---- Actions shared across views --------------------------------------------------- */

  /** Keys listed by the current view, when it has such a notion (the translations grid does). */
  function viewScope() {
    return current && current.instance && current.instance.scope ? current.instance.scope() : null;
  }

  const actions = {
    undo() {
      const label = store.undo();
      if (label) LS.toast("Undone", { description: label, duration: 1800 });
    },
    redo() {
      const label = store.redo();
      if (label) LS.toast("Redone", { description: label, duration: 1800 });
    },
    /**
     * An "Undo" toast action bound to the change that was just made. If something else has
     * happened since (another edit, another project), it says so instead of undoing the wrong thing.
     */
    undoAction() {
      const token = store.undoToken();
      return {
        label: "Undo",
        group: "undo",
        onClick: () => {
          const label = store.undoIfLatest(token);
          if (label) LS.toast("Undone", { description: label, duration: 1800 });
          else LS.toast("Other changes came after this one", { description: "Use " + LS.dom.shortcut("mod+Z") + " to step back through recent changes." });
        },
      };
    },
    palette() {
      LS.palette.open();
    },
    importFiles(files) {
      LS.importDialog.open(files);
    },
    exportProject(opts) {
      if (store.project()) LS.exportDialog.open(opts);
    },
    translate(opts) {
      if (store.project()) LS.translator.openDialog(opts);
    },
    findReplace(lang) {
      if (store.project()) LS.tools.findReplace(lang, viewScope());
    },
    shortcuts() {
      LS.tools.shortcuts();
    },
    newProject() {
      LS.tools.newProject();
    },
    addKey() {
      if (!store.project()) return;
      if (!current || current.name !== "translations") {
        navigate("translations");
        setTimeout(() => current && current.instance && current.instance.addKey && current.instance.addKey(), 60);
      } else if (current.instance && current.instance.addKey) current.instance.addKey();
    },
    focusSearch() {
      if (current && current.name === "translations" && current.instance.focusSearch) current.instance.focusSearch();
    },
    /** Jump to a key in the translations grid. */
    goToKey(key, lang) {
      if (!store.project() || !store.hasKey(key)) return;
      const reveal = () => current && current.instance && current.instance.reveal && current.instance.reveal(key, lang);
      if (!current || current.name !== "translations") {
        navigate("translations");
        setTimeout(reveal, 60);
      } else reveal();
    },
    toggleTheme() {
      store.setSetting("theme", resolvedTheme() === "dark" ? "light" : "dark");
    },
    toggleSidebar() {
      setSidebar(!sidebarIsOpen());
    },
    /** Ask before a destructive action unless the user turned confirmations off. */
    async confirmDelete(o) {
      if (store.state.settings.confirmDeletes === false && !o.always) return true;
      return LS.dialog.confirm(Object.assign({ danger: true, confirmLabel: "Delete" }, o));
    },
    async deleteProject() {
      const p = store.project();
      if (!p) return;
      const ok = await LS.dialog.confirm({
        title: "Delete “" + p.name + "”?",
        message: "The project and its " + util.plural(store.stats(p).total, "key") + " will be removed from this browser.",
        confirmLabel: "Delete project",
        danger: true,
      });
      if (!ok) return;
      const removed = store.deleteProject(p.id);
      LS.toast("Project deleted", { description: p.name, action: { label: "Undo", onClick: () => store.restoreProject(removed) } });
    },
    async renameProject() {
      const p = store.project();
      if (!p) return;
      const name = await LS.dialog.prompt({ title: "Rename project", label: "Name", value: p.name, confirmLabel: "Rename", validate: (v) => (v.trim() ? "" : "Enter a name.") });
      if (name != null) store.renameProject(name);
    },
    duplicateProject() {
      const p = store.project();
      if (!p) return;
      const copy = store.duplicateProject(p.id);
      if (copy) LS.toast("Project duplicated", { description: copy.name, type: "success" });
    },
  };

  /* ---- Global events ------------------------------------------------------------------ */

  function onKeydown(e) {
    if (e.defaultPrevented || LS.dom.isIME(e)) return;
    const { matchKey, isEditable } = LS.dom;
    const dialogOpen = !!document.querySelector("dialog[open]");
    if (matchKey(e, "mod+k")) {
      e.preventDefault();
      if (!dialogOpen) actions.palette();
      return;
    }
    if (dialogOpen) return;
    if (matchKey(e, "mod+b")) {
      e.preventDefault();
      actions.toggleSidebar();
      return;
    }
    const editable = isEditable(e.target);
    if (!editable && matchKey(e, "mod+z")) {
      e.preventDefault();
      actions.undo();
      return;
    }
    if (!editable && (matchKey(e, "shift+mod+z") || matchKey(e, "mod+y"))) {
      e.preventDefault();
      actions.redo();
      return;
    }
    if (editable || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "/") {
      e.preventDefault();
      actions.focusSearch();
    } else if (e.key === "?") {
      e.preventDefault();
      actions.shortcuts();
    } else if ((e.key === "n" || e.key === "N") && store.project()) {
      e.preventDefault();
      actions.addKey();
    }
  }

  function initDragAndDrop() {
    let depth = 0;
    let overlayEl = null;
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
    const show = () => {
      if (overlayEl || document.querySelector("dialog[open]")) return;
      overlayEl = h(
        "div.drop-overlay",
        h("div.drop-overlay-card", icon("upload", { size: 28 }), h("b", "Drop files to import"), h("span", "CSV, JSON or TXT — you choose where they go next"))
      );
      document.body.appendChild(overlayEl);
    };
    const hide = () => {
      depth = 0;
      if (overlayEl) overlayEl.remove();
      overlayEl = null;
    };
    window.addEventListener("dragenter", (e) => {
      if (!hasFiles(e)) return;
      depth++;
      show();
    });
    window.addEventListener("dragleave", (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) hide();
    });
    window.addEventListener("dragover", (e) => {
      if (hasFiles(e)) e.preventDefault();
    });
    window.addEventListener("drop", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files || []);
      hide();
      if (!files.length) return;
      if (LS.importDialog.addFiles(files)) return; // an import dialog is already open
      if (document.querySelector("dialog[open]")) return;
      actions.importFiles(files);
    });
  }

  /* ---- Boot --------------------------------------------------------------------------- */

  function start(container, bootInfo) {
    root = container;
    root.className = "app";
    root.dataset.sidebar = store.state.ui.sidebarCollapsed ? "closed" : "open";
    root.dataset.drawer = "closed";
    viewEl = h("div.view");
    LS.dom.replaceChildren(root, buildSidebar(), h("div.sidebar-scrim", { onClick: closeDrawer }), h("main.main", h("div.main-panel", viewEl)));

    applyTheme();
    if (darkQuery) {
      const onScheme = () => applyTheme();
      if (darkQuery.addEventListener) darkQuery.addEventListener("change", onScheme);
      else if (darkQuery.addListener) darkQuery.addListener(onScheme);
    }

    store.on("settings", (d) => {
      if (d.path === "theme" || d.path === "*") applyTheme();
      refreshSidebarSoon();
    });
    // The view is closed while its own project is still the current one, so anything it
    // saves on the way out lands in the right project.
    store.on("before-project-change", () => teardown());
    store.on("projects", (d) => {
      if (d.reason === "meta") return updateSidebar();
      renderView(true);
    });
    store.on("project", () => refreshSidebarSoon());
    store.on("entries", (d) => {
      if (d.kind !== "cell") refreshSidebarSoon();
    });
    store.on("view", (d) => {
      if (d.keys.includes("namespace")) updateSidebar();
    });
    store.on("save", () => {
      const el = sidebarEl && sidebarEl.querySelector(".save-state");
      if (el) el.replaceWith(saveStateEl());
      if (store.saveStatus === "error" && !start.warned) {
        start.warned = true;
        LS.toast("Your changes could not be saved", { type: "error", description: "Storage may be full or blocked. Export your project to keep a copy.", duration: 12000 });
      }
      if (store.saveStatus === "saved") start.warned = false;
    });

    window.addEventListener("hashchange", () => renderView());
    document.addEventListener("keydown", onKeydown);
    // The page is being hidden or closed, which may be the last chance to save: take what is
    // being typed (editors stay open) and hand everything to storage right away.
    const saveNow = () => {
      flushView();
      store.flush({ now: true });
    };
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") saveNow();
    });
    window.addEventListener("pagehide", saveNow);
    window.addEventListener("beforeunload", (e) => {
      // If the last save failed, ask before leaving (the save below is tried again regardless).
      const failed = store.saveStatus === "error" && store.hasPendingChanges();
      saveNow();
      if (failed) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
    initDragAndDrop();
    renderView(true);

    if (bootInfo && bootInfo.migrated) {
      LS.toast("Welcome to the new Language Surface", { type: "success", description: "Your projects and settings were carried over.", duration: 7000 });
    }
  }

  LS.views = LS.views || {};
  LS.shell = { start, scope, topbar, navigate, renderView, avatar, projectSummary, resolvedTheme, updateSidebar, initials };
  LS.app = { actions, navigate, get route() {
    return current ? current.name : null;
  } };
})(globalThis.LS || (globalThis.LS = {}));
