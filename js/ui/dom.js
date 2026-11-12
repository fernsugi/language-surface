/* Language Surface — tiny DOM toolkit: hyperscript builder and form/control components. */
(function (LS) {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  function appendChildren(el, children) {
    for (const child of children) {
      if (child == null || child === false || child === true) continue;
      if (Array.isArray(child)) appendChildren(el, child);
      else if (child instanceof Node) el.appendChild(child);
      else el.appendChild(document.createTextNode(String(child)));
    }
  }

  function setClass(el, value) {
    if (!value) return;
    if (typeof value === "string") {
      for (const c of value.split(/\s+/)) if (c) el.classList.add(c);
    } else if (Array.isArray(value)) {
      value.forEach((v) => setClass(el, v));
    } else {
      for (const k of Object.keys(value)) if (value[k]) el.classList.add(k);
    }
  }

  /**
   * Create an element.
   *   h("button.btn.primary", { onClick, disabled: true, "aria-label": "Save" }, icon("check"), "Save")
   * Props: class, style, dataset, attrs, text, html, ref, on<Event>, plus any DOM property or attribute.
   */
  function h(spec, props, ...children) {
    if (props != null && (typeof props !== "object" || props instanceof Node || Array.isArray(props))) {
      children.unshift(props);
      props = null;
    }
    const parts = String(spec).split(/(?=[.#])/);
    const tag = parts[0] && !/^[.#]/.test(parts[0]) ? parts.shift() : "div";
    const el = tag === "svg" || tag === "path" ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
    for (const part of parts) {
      if (part[0] === ".") el.classList.add(part.slice(1));
      else if (part[0] === "#") el.id = part.slice(1);
    }
    if (props) {
      for (const key of Object.keys(props)) {
        const value = props[key];
        if (value == null || value === false) {
          if (key === "disabled" || key === "checked" || key === "hidden") el[key] = false;
          continue;
        }
        if (key === "class") setClass(el, value);
        else if (key === "style") {
          if (typeof value === "string") el.style.cssText = value;
          else for (const s of Object.keys(value)) el.style.setProperty(s.startsWith("--") ? s : s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase()), value[s]);
        } else if (key === "dataset") Object.assign(el.dataset, value);
        else if (key === "attrs") {
          for (const a of Object.keys(value)) {
            if (value[a] != null && value[a] !== false) el.setAttribute(a, value[a] === true ? "" : value[a]);
          }
        } else if (key === "text") el.textContent = value;
        else if (key === "html") el.innerHTML = value;
        else if (key === "ref") value(el);
        else if (key.length > 2 && key[0] === "o" && key[1] === "n" && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
        else if (key in el && !key.startsWith("aria-") && key !== "role" && key !== "list" && key !== "form") {
          try {
            el[key] = value;
          } catch (e) {
            el.setAttribute(key, value);
          }
        } else el.setAttribute(key, value === true ? "" : value);
      }
    }
    appendChildren(el, children);
    return el;
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  function replaceChildren(el, ...children) {
    clear(el);
    appendChildren(el, children);
    return el;
  }

  /** Delegated listener: handler(event, matchedElement). Returns an unsubscribe function. */
  function delegate(root, type, selector, handler, opts) {
    const listener = (e) => {
      const target = e.target instanceof Element ? e.target.closest(selector) : null;
      if (target && root.contains(target)) handler(e, target);
    };
    root.addEventListener(type, listener, opts);
    return () => root.removeEventListener(type, listener, opts);
  }

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  function focusables(root) {
    return Array.from(root.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null || el.getClientRects().length);
  }

  /** Grow a textarea to fit its content (within CSS min/max-height). */
  function autosize(ta) {
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + 2 + "px";
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // Fallback for non-secure contexts (file://).
      const ta = h("textarea", { value: text, style: "position:fixed;opacity:0;pointer-events:none;top:0;left:0" });
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (err) {
        ok = false;
      }
      ta.remove();
      return ok;
    }
  }

  function download(filename, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: filename, style: "display:none" });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
  }

  /** Keyboard shortcut label for the current platform: kbd("mod+K") -> "⌘K" / "Ctrl K". */
  function shortcut(combo) {
    const mac = LS.util.isMac;
    return combo
      .split("+")
      .map((k) => {
        const key = k.trim().toLowerCase();
        if (key === "mod") return mac ? "⌘" : "Ctrl";
        if (key === "shift") return mac ? "⇧" : "Shift";
        if (key === "alt") return mac ? "⌥" : "Alt";
        if (key === "enter") return "↵";
        if (key === "esc") return "Esc";
        if (key === "backspace") return "⌫";
        if (key === "up") return "↑";
        if (key === "down") return "↓";
        if (key === "left") return "←";
        if (key === "right") return "→";
        return k.trim().length === 1 ? k.trim().toUpperCase() : k.trim();
      })
      .join(mac ? "" : " ");
  }

  /** Does the event match "mod+k", "shift+mod+z", "/" …? */
  function matchKey(e, combo) {
    const parts = combo.toLowerCase().split("+");
    const key = parts.pop();
    const mod = LS.util.isMac ? e.metaKey : e.ctrlKey;
    if (!!mod !== parts.includes("mod") || !!e.altKey !== parts.includes("alt")) return false;
    // Shift must match for letters, digits and named keys. For symbols ("?", "/") it is part of typing them.
    const strictShift = key.length > 1 || /^[a-z0-9]$/.test(key);
    if (strictShift && !!e.shiftKey !== parts.includes("shift")) return false;
    return String(e.key).toLowerCase() === key;
  }

  /**
   * True while an input method (Japanese, Chinese, Korean …) is composing text. The Enter that
   * confirms a composition must never trigger "submit"; Safari reports it with keyCode 229 only.
   */
  function isIME(e) {
    return !!e.isComposing || e.keyCode === 229;
  }

  /** Compare text ignoring the line-ending style (textareas always report "\n"). */
  function sameText(a, b) {
    if (a === b) return true;
    const norm = (v) => String(v == null ? "" : v).replace(/\r\n?/g, "\n");
    return norm(a) === norm(b);
  }

  function isEditable(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
  }

  /* ---- Components ------------------------------------------------------------- */

  const icon = (...args) => LS.icon(...args);

  /**
   * Button.
   * @param {{label?, icon?, iconRight?, variant?, size?, onClick?, tip?, kbd?, disabled?, type?, class?, attrs?, ariaLabel?}} o
   */
  function button(o) {
    const iconOnly = !o.label && o.icon;
    const el = h(
      "button.btn",
      {
        type: o.type || "button",
        class: [o.variant || "", o.size || "", iconOnly ? "icon-only" : "", o.class || ""],
        disabled: !!o.disabled,
        onClick: o.onClick,
        attrs: o.attrs,
      },
      o.icon ? icon(o.icon, { size: o.iconSize || (o.size === "sm" ? 14 : 15) }) : null,
      o.label ? h("span.btn-label", o.label) : null,
      o.kbd ? h("kbd.kbd", shortcut(o.kbd)) : null,
      o.iconRight ? icon(o.iconRight, { size: 14, class: "btn-caret" }) : null
    );
    if (o.tip) {
      el.dataset.tip = o.tip;
      if (o.tipKbd) el.dataset.tipKbd = shortcut(o.tipKbd);
    }
    if (iconOnly || o.ariaLabel) el.setAttribute("aria-label", o.ariaLabel || o.tip || o.icon);
    return el;
  }

  /** Put a button into / out of its loading state. */
  function setBusy(btn, busy) {
    btn.classList.toggle("busy", !!busy);
    btn.disabled = !!busy;
    let sp = btn.querySelector(":scope > .btn-spinner");
    if (busy && !sp) btn.prepend(h("span.btn-spinner", icon("loader-circle", { size: 14, class: "spin" })));
    else if (!busy && sp) sp.remove();
  }

  function kbd(combo) {
    return h("kbd.kbd", shortcut(combo));
  }

  /** Language code chip. */
  function langTag(code, opts) {
    const o = opts || {};
    return h("span.lang-tag", { class: { source: !!o.source, lg: !!o.large }, title: o.title || LS.langs.displayName(code) }, LS.langs.label(code));
  }

  function toggle(o) {
    const input = h("input.switch-input", {
      type: "checkbox",
      checked: !!o.checked,
      disabled: !!o.disabled,
      id: o.id,
      role: "switch",
      onChange: (e) => o.onChange && o.onChange(e.target.checked),
    });
    if (o.ariaLabel) input.setAttribute("aria-label", o.ariaLabel);
    return h("span.switch", input, h("span.switch-track", h("span.switch-thumb")));
  }

  function checkbox(o) {
    const input = h("input.check-input", {
      type: "checkbox",
      checked: !!o.checked,
      disabled: !!o.disabled,
      id: o.id,
      onChange: (e) => o.onChange && o.onChange(e.target.checked, e),
      onClick: o.onClick,
    });
    if (o.ariaLabel) input.setAttribute("aria-label", o.ariaLabel);
    if (o.indeterminate) input.indeterminate = true;
    const box = h("span.check", { class: o.class || "" }, input, h("span.check-box"));
    if (!o.label) return box;
    return h("label.check-row", box, h("span", o.label));
  }

  /**
   * Segmented control.
   * @param {{options: {value, label?, icon?, tip?, count?}[], value, onChange, size?, ariaLabel?}} o
   */
  function segmented(o) {
    const root = h("div.segmented", { role: "radiogroup", class: o.size || "", "aria-label": o.ariaLabel || null });
    const render = (value) => {
      clear(root);
      for (const opt of o.options) {
        const active = opt.value === value;
        const btn = h(
          "button.segmented-item",
          {
            type: "button",
            role: "radio",
            "aria-checked": active ? "true" : "false",
            tabIndex: active ? 0 : -1,
            class: { active },
            onClick: () => {
              if (opt.value === root.value) return;
              root.value = opt.value;
              render(opt.value);
              o.onChange && o.onChange(opt.value);
            },
          },
          opt.icon ? icon(opt.icon, { size: 14 }) : null,
          opt.label ? h("span", opt.label) : null,
          opt.count != null ? h("span.segmented-count.num", String(opt.count)) : null
        );
        if (opt.tip) btn.dataset.tip = opt.tip;
        if (!opt.label) btn.setAttribute("aria-label", opt.tip || String(opt.value));
        root.appendChild(btn);
      }
    };
    root.value = o.value;
    root.setValue = (v) => {
      if (v === root.value) return;
      root.value = v;
      render(v);
    };
    // Counts change often (after every edit). Update them in place: replacing the buttons while
    // the pointer is down on one of them would swallow the click.
    root.setOptions = (options) => {
      const same = options.length === o.options.length && options.every((x, i) => x.value === o.options[i].value && x.label === o.options[i].label && x.icon === o.options[i].icon);
      o.options = options;
      if (!same) return render(root.value);
      Array.from(root.children).forEach((btn, i) => {
        const count = btn.querySelector(".segmented-count");
        if (count && options[i].count != null && count.textContent !== String(options[i].count)) count.textContent = String(options[i].count);
      });
    };
    root.addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
      const items = Array.from(root.children);
      const i = items.findIndex((b) => b.classList.contains("active"));
      const next = items[(i + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1) + items.length) % items.length];
      if (next) {
        e.preventDefault();
        next.click();
        const again = Array.from(root.children).find((b) => b.classList.contains("active"));
        if (again) again.focus();
      }
    });
    render(o.value);
    return root;
  }

  /** Native select with app styling. options: [{value, label, disabled?}] or [{group, options}] */
  function select(o) {
    const el = h("select.select", { class: [o.size || "", o.class || ""], id: o.id, disabled: !!o.disabled, onChange: (e) => o.onChange && o.onChange(e.target.value) });
    if (o.ariaLabel) el.setAttribute("aria-label", o.ariaLabel);
    const add = (parent, opt) => parent.appendChild(h("option", { value: opt.value, disabled: !!opt.disabled, selected: String(opt.value) === String(o.value) }, opt.label));
    for (const opt of o.options) {
      if (opt.group) {
        const g = h("optgroup", { label: opt.group });
        opt.options.forEach((x) => add(g, x));
        el.appendChild(g);
      } else add(el, opt);
    }
    return el;
  }

  /** Label + control + hint/error wrapper. */
  function field(o) {
    const id = o.id || LS.util.uid("f");
    if (o.control && !o.control.id && /^(INPUT|SELECT|TEXTAREA)$/.test(o.control.tagName)) o.control.id = id;
    const forId = o.control && o.control.id ? o.control.id : null;
    return h(
      "div.field",
      { class: o.class || "" },
      o.label ? h("label.field-label", { for: forId }, o.label, o.optional ? h("span.field-optional", "Optional") : null) : null,
      o.control,
      o.hint ? h("div.field-hint", o.hint) : null,
      h("div.field-error", { hidden: true, role: "alert" })
    );
  }

  function setFieldError(fieldEl, message) {
    const err = fieldEl.querySelector(".field-error");
    if (!err) return;
    err.textContent = message || "";
    err.hidden = !message;
    fieldEl.classList.toggle("invalid", !!message);
  }

  /** Progress meter: fill on a lighter track of the same hue. */
  function meter(value, max, opts) {
    const o = opts || {};
    const pct = max > 0 ? LS.util.clamp((value / max) * 100, 0, 100) : 0;
    const el = h("div.meter", { class: [o.class || "", pct >= 100 ? "done" : ""], role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(pct) });
    if (o.label) el.setAttribute("aria-label", o.label);
    el.appendChild(h("div.meter-fill", { style: { width: pct + "%" } }));
    return el;
  }

  function emptyState(o) {
    return h(
      "div.empty",
      { class: o.class || "" },
      o.icon ? h("div.empty-icon", icon(o.icon, { size: 22 })) : null,
      h("h3.empty-title", o.title),
      o.text ? h("p.empty-text", o.text) : null,
      o.actions && o.actions.length ? h("div.empty-actions", o.actions) : null
    );
  }

  function spinner(size) {
    return icon("loader-circle", { size: size || 16, class: "spin" });
  }

  LS.h = h;
  LS.dom = { h, clear, replaceChildren, delegate, focusables, autosize, copyText, download, shortcut, matchKey, isEditable, isIME, sameText };
  LS.ui = { button, setBusy, kbd, langTag, toggle, checkbox, segmented, select, field, setFieldError, meter, emptyState, spinner };
})(globalThis.LS || (globalThis.LS = {}));
