/* Language Surface — overlays: popovers, menus, tooltips, toasts and modal dialogs. */
(function (LS) {
  "use strict";

  const h = LS.h;
  const icon = LS.icon;
  const { shortcut, focusables } = LS.dom;

  const supportsPopover = typeof HTMLElement !== "undefined" && Object.prototype.hasOwnProperty.call(HTMLElement.prototype, "popover");
  const stack = []; // open popovers, oldest first

  /** Put an element in the top layer (so it also shows above modal dialogs). */
  function mountTop(el) {
    if (supportsPopover) {
      el.setAttribute("popover", "manual");
      document.body.appendChild(el);
      try {
        el.showPopover();
        return;
      } catch (e) {
        el.removeAttribute("popover");
      }
    }
    const dialogs = document.querySelectorAll("dialog[open]");
    (dialogs.length ? dialogs[dialogs.length - 1] : document.body).appendChild(el);
  }

  function unmountTop(el) {
    try {
      if (supportsPopover && el.matches(":popover-open")) el.hidePopover();
    } catch (e) {
      /* ignore */
    }
    el.remove();
  }

  function rectOf(anchor) {
    if (anchor instanceof Element) return anchor.getBoundingClientRect();
    const x = anchor.x || 0;
    const y = anchor.y || 0;
    return { left: x, right: x, top: y, bottom: y, width: 0, height: 0 };
  }

  /** Position `el` next to `anchor`, flipping and clamping to stay inside the viewport. */
  function place(el, anchor, opts) {
    const o = opts || {};
    const margin = 8;
    const gap = o.offset == null ? 6 : o.offset;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const a = rectOf(anchor);
    el.style.maxHeight = "";
    el.style.minWidth = o.matchWidth ? Math.round(a.width) + "px" : "";
    el.style.left = "0px";
    el.style.top = "0px";
    const r = el.getBoundingClientRect();
    let [side, align] = String(o.placement || "bottom-start").split("-");
    let left;
    let top;
    let height = r.height;

    if (side === "bottom" || side === "top") {
      const below = vh - a.bottom - gap - margin;
      const above = a.top - gap - margin;
      if (side === "bottom" && r.height > below && above > below) side = "top";
      else if (side === "top" && r.height > above && below > above) side = "bottom";
      const avail = Math.max(120, side === "bottom" ? below : above);
      if (r.height > avail) {
        height = avail;
        el.style.maxHeight = avail + "px";
      }
      top = side === "bottom" ? a.bottom + gap : a.top - gap - height;
      if (align === "end") left = a.right - r.width;
      else if (align === "center") left = a.left + a.width / 2 - r.width / 2;
      else left = a.left;
    } else {
      const rightSpace = vw - a.right - gap - margin;
      const leftSpace = a.left - gap - margin;
      if (side === "right" && r.width > rightSpace && leftSpace > rightSpace) side = "left";
      else if (side === "left" && r.width > leftSpace && rightSpace > leftSpace) side = "right";
      left = side === "right" ? a.right + gap : a.left - gap - r.width;
      if (r.height > vh - margin * 2) {
        height = vh - margin * 2;
        el.style.maxHeight = height + "px";
      }
      if (align === "end") top = a.bottom - height;
      else if (align === "center") top = a.top + a.height / 2 - height / 2;
      else top = a.top;
    }
    left = LS.util.clamp(left, margin, Math.max(margin, vw - r.width - margin));
    top = LS.util.clamp(top, margin, Math.max(margin, vh - height - margin));
    el.style.left = Math.round(left) + "px";
    el.style.top = Math.round(top) + "px";
    el.dataset.side = side;
  }

  /**
   * Open a floating panel anchored to an element (or a {x, y} point).
   * @returns {{el, close: (opts?) => void, reposition: () => void, isOpen: boolean}}
   */
  function popover(anchor, content, opts) {
    const o = opts || {};
    const el = h("div.popover", { class: o.class || "", role: o.role || "dialog", tabIndex: -1 });
    if (o.label) el.setAttribute("aria-label", o.label);
    if (content) el.append(...(Array.isArray(content) ? content : [content]));
    const anchorEl = anchor instanceof Element ? anchor : null;
    const previousFocus = document.activeElement;
    let raf = 0;

    const ctl = {
      el,
      anchorEl,
      isOpen: true,
      reposition() {
        if (!ctl.isOpen) return;
        if (anchorEl && !anchorEl.isConnected) return ctl.close({ restoreFocus: false });
        place(el, anchor, o);
      },
      close(closeOpts) {
        if (!ctl.isOpen) return;
        ctl.isOpen = false;
        const i = stack.indexOf(ctl);
        if (i !== -1) stack.splice(i, 1);
        window.removeEventListener("resize", onViewport);
        window.removeEventListener("scroll", onViewport, true);
        cancelAnimationFrame(raf);
        if (anchorEl) {
          anchorEl.removeAttribute("aria-expanded");
          if (anchorEl._popover === ctl) anchorEl._popover = null;
        }
        const restore = !(closeOpts && closeOpts.restoreFocus === false) && o.restoreFocus !== false;
        const hadFocus = el.contains(document.activeElement);
        unmountTop(el);
        if (restore && hadFocus && previousFocus && previousFocus.isConnected && previousFocus.focus) previousFocus.focus({ preventScroll: true });
        if (o.onClose) o.onClose();
      },
    };

    function onViewport(e) {
      if (e && e.type === "scroll" && e.target instanceof Node && el.contains(e.target)) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(ctl.reposition);
    }

    mountTop(el);
    place(el, anchor, o);
    stack.push(ctl);
    if (anchorEl) {
      anchorEl.setAttribute("aria-expanded", "true");
      anchorEl._popover = ctl;
    }
    window.addEventListener("resize", onViewport);
    window.addEventListener("scroll", onViewport, true);
    if (o.autoFocus !== false) {
      const target = el.querySelector("[autofocus]") || (o.focusFirst ? focusables(el)[0] : null) || el;
      target.focus({ preventScroll: true });
    }
    return ctl;
  }

  /** Open a popover from a trigger, or close it if that trigger already has one open. */
  function toggle(anchor, build) {
    if (anchor._popover && anchor._popover.isOpen) {
      anchor._popover.close();
      return null;
    }
    return build();
  }

  function closeTop() {
    const top = stack[stack.length - 1];
    if (!top) return false;
    top.close();
    return true;
  }

  function closeAll() {
    while (stack.length) stack[stack.length - 1].close({ restoreFocus: false });
  }

  if (typeof document !== "undefined") {
    document.addEventListener(
      "pointerdown",
      (e) => {
        if (!stack.length) return;
        const target = e.target;
        let keep = -1;
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].el.contains(target)) {
            keep = i;
            break;
          }
        }
        for (let i = stack.length - 1; i > keep; i--) {
          const p = stack[i];
          // A press on the trigger is left to the trigger's own toggle logic.
          if (p.anchorEl && p.anchorEl.contains(target)) continue;
          p.close({ restoreFocus: false });
        }
      },
      true
    );
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape" && stack.length) {
          e.preventDefault();
          e.stopPropagation();
          closeTop();
        }
      },
      true
    );
  }

  /* ---- Menu ---------------------------------------------------------------------- */

  /**
   * Dropdown menu.
   * items: { label, icon?, kbd?, hint?, checked?, danger?, disabled?, keepOpen?, onSelect } | { separator: true }
   *        | { heading: "…" } | { custom: Node }
   */
  function menu(anchor, items, opts) {
    const o = Object.assign({ placement: "bottom-start" }, opts || {});
    const list = h("div.menu", { role: "menu" });
    let ctl = null;
    const hasIcons = items.some((it) => it && it.icon);

    for (const item of items) {
      if (!item) continue;
      if (item.separator) {
        if (list.lastChild && !list.lastChild.classList.contains("menu-sep")) list.appendChild(h("div.menu-sep", { role: "separator" }));
        continue;
      }
      if (item.heading) {
        list.appendChild(h("div.menu-heading", item.heading));
        continue;
      }
      if (item.custom) {
        list.appendChild(item.custom);
        continue;
      }
      const checkable = item.checked != null;
      const el = h(
        "button.menu-item",
        {
          type: "button",
          role: checkable ? "menuitemcheckbox" : "menuitem",
          class: { danger: !!item.danger },
          disabled: !!item.disabled,
          tabIndex: -1,
          "aria-checked": checkable ? String(!!item.checked) : null,
          onClick: () => {
            if (item.keepOpen) {
              if (item.onSelect) item.onSelect(el, ctl);
              return;
            }
            ctl.close();
            if (item.onSelect) item.onSelect();
          },
        },
        item.icon ? icon(item.icon, { size: 15, class: "menu-icon" }) : hasIcons ? h("span.menu-icon-gap") : null,
        h("span.menu-label", item.label, item.hint ? h("span.menu-hint", item.hint) : null),
        checkable ? icon("check", { size: 14, class: "menu-check" + (item.checked ? "" : " off") }) : null,
        item.kbd ? h("kbd.menu-kbd", shortcut(item.kbd)) : null
      );
      list.appendChild(el);
    }
    if (list.lastChild && list.lastChild.classList.contains("menu-sep")) list.lastChild.remove();

    const enabled = () => Array.from(list.querySelectorAll(".menu-item:not(:disabled)"));
    const focusAt = (i) => {
      const els = enabled();
      if (!els.length) return;
      els[(i + els.length) % els.length].focus({ preventScroll: false });
    };
    let typed = "";
    let typedAt = 0;
    list.addEventListener("keydown", (e) => {
      const els = enabled();
      const i = els.indexOf(document.activeElement);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        focusAt(i + 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        focusAt(i === -1 ? els.length - 1 : i - 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        focusAt(0);
      } else if (e.key === "End") {
        e.preventDefault();
        focusAt(els.length - 1);
      } else if (e.key === "Tab") {
        ctl.close();
      } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && !LS.dom.isEditable(e.target)) {
        const now = Date.now();
        typed = now - typedAt > 600 ? e.key.toLowerCase() : typed + e.key.toLowerCase();
        typedAt = now;
        const hit = els.find((el) => el.textContent.trim().toLowerCase().startsWith(typed));
        if (hit) hit.focus();
      }
    });
    list.addEventListener("pointermove", (e) => {
      const item = e.target instanceof Element ? e.target.closest(".menu-item:not(:disabled)") : null;
      if (item && document.activeElement !== item && !LS.dom.isEditable(document.activeElement)) item.focus({ preventScroll: true });
    });

    ctl = popover(anchor, list, Object.assign({}, o, { class: "menu-popover " + (o.class || ""), role: "presentation", autoFocus: false }));
    const auto = list.querySelector("[autofocus]");
    if (auto) auto.focus({ preventScroll: true });
    else if (o.focus === "first") focusAt(0);
    else list.tabIndex = -1, list.focus({ preventScroll: true });
    ctl.list = list;
    return ctl;
  }

  /** Menu at the pointer position (for right-click). */
  function contextMenu(event, items, opts) {
    event.preventDefault();
    closeAll();
    return menu({ x: event.clientX, y: event.clientY }, items, Object.assign({ offset: 2 }, opts || {}));
  }

  /* ---- Tooltips ------------------------------------------------------------------- */

  let tipEl = null;
  let tipTarget = null;
  let tipTimer = 0;
  let tipWarmUntil = 0;

  function hideTip() {
    clearTimeout(tipTimer);
    if (tipEl) {
      unmountTop(tipEl);
      tipEl = null;
      tipWarmUntil = Date.now() + 300;
    }
    tipTarget = null;
  }

  function showTip(target) {
    if (!target.isConnected || !target.dataset.tip) return;
    if (target._popover && target._popover.isOpen) return;
    tipEl = h("div.tooltip", { role: "tooltip" }, h("span", target.dataset.tip), target.dataset.tipKbd ? h("kbd.tooltip-kbd", target.dataset.tipKbd) : null);
    mountTop(tipEl);
    place(tipEl, target, { placement: (target.dataset.tipSide || "top") + "-center", offset: 6 });
  }

  function scheduleTip(target, immediate) {
    if (tipTarget === target) return;
    hideTip();
    tipTarget = target;
    const delay = immediate || Date.now() < tipWarmUntil ? 60 : 450;
    tipTimer = setTimeout(() => showTip(target), delay);
  }

  if (typeof document !== "undefined") {
    document.addEventListener("pointerover", (e) => {
      if (e.pointerType === "touch") return;
      const target = e.target instanceof Element ? e.target.closest("[data-tip]") : null;
      if (target) scheduleTip(target, false);
      else if (tipTarget) hideTip();
    });
    document.addEventListener("pointerdown", hideTip, true);
    document.addEventListener("keydown", hideTip, true);
    document.addEventListener("scroll", hideTip, true);
    document.addEventListener("focusin", (e) => {
      const target = e.target instanceof Element ? e.target.closest("[data-tip]") : null;
      let visible = false;
      try {
        visible = !!target && target.matches(":focus-visible");
      } catch (err) {
        visible = false;
      }
      if (visible) scheduleTip(target, true);
    });
    document.addEventListener("focusout", hideTip);
  }

  /* ---- Toasts --------------------------------------------------------------------- */

  let toastHost = null;
  const TOAST_ICONS = { success: "circle-check", error: "circle-alert", warning: "triangle-alert", info: "info" };

  function ensureToastHost() {
    if (!toastHost) toastHost = h("div.toasts", { role: "region", "aria-label": "Notifications" });
    // Re-mount so the host sits above anything opened since (e.g. a modal dialog).
    if (toastHost.isConnected) unmountTop(toastHost);
    mountTop(toastHost);
    return toastHost;
  }

  /**
   * Show a toast.
   * @param {string} message
   * @param {{description?, type?: "success"|"error"|"warning"|"info", action?: {label, onClick}, duration?: number}} [opts]
   */
  function toast(message, opts) {
    const o = opts || {};
    const host = ensureToastHost();
    const type = o.type || "info";
    let timer = 0;
    let remaining = o.duration != null ? o.duration : o.action ? 7000 : type === "error" ? 8000 : 3600;

    // Keep the stack short: a new toast retires plain notices, and a new "Undo" replaces the
    // previous one (which could no longer undo anything anyway).
    for (const old of Array.from(host.children)) {
      if (!old._toast) continue;
      if (old._toast.group && o.action && old._toast.group === o.action.group) old._toast.dismiss();
      else if (!old._toast.hasAction && old._toast.type !== "error") old._toast.dismiss();
    }

    const el = h(
      "div.toast",
      { class: type, role: type === "error" ? "alert" : "status" },
      o.type ? h("span.toast-icon", icon(TOAST_ICONS[type] || "info", { size: 16 })) : null,
      h("div.toast-body", h("div.toast-title", message), o.description ? h("div.toast-desc", o.description) : null),
      o.action
        ? h(
            "button.toast-action",
            {
              type: "button",
              onClick: () => {
                dismiss();
                o.action.onClick();
              },
            },
            o.action.label
          )
        : null,
      h("button.toast-close", { type: "button", "aria-label": "Dismiss", onClick: () => dismiss() }, icon("x", { size: 14 }))
    );

    let started = 0;
    const start = () => {
      if (!isFinite(remaining) || remaining <= 0) return;
      started = Date.now();
      timer = setTimeout(dismiss, remaining);
    };
    const pause = () => {
      clearTimeout(timer);
      if (started) remaining -= Date.now() - started;
      started = 0;
    };
    function dismiss() {
      clearTimeout(timer);
      if (!el.isConnected || el.classList.contains("leaving")) return;
      el.classList.add("leaving");
      setTimeout(() => {
        el.remove();
        if (toastHost && !toastHost.children.length) unmountTop(toastHost);
      }, 180);
    }
    el.addEventListener("pointerenter", pause);
    el.addEventListener("pointerleave", start);

    el._toast = { dismiss, hasAction: !!o.action, group: (o.action && o.action.group) || null, type };
    host.appendChild(el);
    const live = Array.from(host.children).filter((n) => !n.classList.contains("leaving"));
    while (live.length > 3) live.shift().remove();
    start();
    return { dismiss, el };
  }

  /* ---- Dialogs -------------------------------------------------------------------- */

  /**
   * Modal dialog.
   * @param {{title?, description?, body?, footer?, size?: "sm"|"md"|"lg"|"xl", class?, dismissable?, onClose?, form?: boolean}} opts
   * @returns {{el, panel, body, footer, close: (result?) => void, closed: Promise<any>}}
   */
  function dialog(opts) {
    const o = opts || {};
    const titleId = LS.util.uid("dlg");
    let resolve;
    const closed = new Promise((r) => (resolve = r));
    let isClosed = false;

    const body = h("div.dialog-body");
    if (o.body) body.append(...(Array.isArray(o.body) ? o.body : [o.body]).filter(Boolean));
    const footer = h("footer.dialog-foot");
    if (o.footer) footer.append(...o.footer.filter(Boolean));

    const closeBtn = h("button.btn.ghost.icon-only.dialog-close", { type: "button", "aria-label": "Close", onClick: () => api.close(null) }, icon("x", { size: 16 }));
    const head = h(
      "header.dialog-head",
      h("div.dialog-heading", h("h2.dialog-title", { id: titleId }, o.title || ""), o.description ? h("p.dialog-desc", o.description) : null),
      o.dismissable === false ? null : closeBtn
    );

    const panel = h(o.form ? "form.dialog-panel" : "div.dialog-panel", { class: [o.size || "md", o.class || ""] }, o.title ? head : null, body, o.footer ? footer : null);
    if (o.form) panel.setAttribute("novalidate", "");
    const el = h("dialog.dialog", { class: o.dialogClass || "", "aria-labelledby": o.title ? titleId : null, "aria-label": !o.title && o.label ? o.label : null }, panel);

    const api = {
      el,
      panel,
      body,
      footer,
      closed,
      close(result, force) {
        if (isClosed) return;
        if (!force && o.beforeClose && o.beforeClose(result) === false) return;
        isClosed = true;
        el.classList.add("closing");
        const finish = () => {
          try {
            el.close();
          } catch (e) {
            /* ignore */
          }
          el.remove();
          if (o.onClose) o.onClose(result);
          resolve(result === undefined ? null : result);
        };
        setTimeout(finish, 130);
      },
    };

    el.addEventListener("cancel", (e) => {
      e.preventDefault();
      if (closeTop()) return;
      if (o.dismissable !== false) api.close(null);
    });
    let downOnBackdrop = false;
    el.addEventListener("pointerdown", (e) => {
      downOnBackdrop = e.target === el;
    });
    el.addEventListener("click", (e) => {
      if (e.target === el && downOnBackdrop && o.dismissable !== false) api.close(null);
      downOnBackdrop = false;
    });

    document.body.appendChild(el);
    el.showModal();
    const auto = el.querySelector("[autofocus]");
    if (auto) auto.focus();
    return api;
  }

  /** Confirmation dialog. Resolves true when confirmed. */
  function confirm(o) {
    return new Promise((resolve) => {
      const ok = LS.ui.button({ label: o.confirmLabel || "Confirm", variant: o.danger ? "danger-solid" : "primary", attrs: { autofocus: true }, onClick: () => dlg.close(true) });
      const cancel = LS.ui.button({ label: o.cancelLabel || "Cancel", onClick: () => dlg.close(false) });
      const body = [];
      if (o.message) body.push(h("p.dialog-text", o.message));
      if (o.detail) body.push(o.detail);
      const dlg = dialog({ title: o.title || "Are you sure?", body, footer: [cancel, ok], size: "sm", class: "confirm" });
      dlg.closed.then((v) => resolve(v === true));
    });
  }

  /** Single-field prompt. Resolves the entered string, or null when cancelled. */
  function prompt(o) {
    return new Promise((resolve) => {
      const input = h("input.input", {
        type: "text",
        value: o.value || "",
        placeholder: o.placeholder || "",
        class: o.mono ? "mono" : "",
        autocomplete: "off",
        spellcheck: false,
        attrs: { autofocus: true },
      });
      const fieldEl = LS.ui.field({ label: o.label, control: input, hint: o.hint });
      const submit = LS.ui.button({ label: o.confirmLabel || "Save", variant: "primary", type: "submit" });
      const cancel = LS.ui.button({ label: "Cancel", onClick: () => dlg.close(null) });
      const dlg = dialog({ title: o.title, description: o.description, body: fieldEl, footer: [cancel, submit], size: "sm", form: true });
      input.addEventListener("input", () => LS.ui.setFieldError(fieldEl, ""));
      dlg.panel.addEventListener("submit", (e) => {
        e.preventDefault();
        const value = input.value;
        const error = o.validate ? o.validate(value) : "";
        if (error) {
          LS.ui.setFieldError(fieldEl, error);
          input.focus();
          return;
        }
        dlg.close(value);
      });
      input.select();
      dlg.closed.then((v) => resolve(typeof v === "string" ? v : null));
    });
  }

  LS.overlay = { popover, toggle, menu, contextMenu, closeTop, closeAll, place, hideTip, hasOpen: () => stack.length > 0 };
  LS.toast = toast;
  LS.dialog = { open: dialog, confirm, prompt };
})(globalThis.LS || (globalThis.LS = {}));
