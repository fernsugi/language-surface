/* Language Surface — boot. */
(function (LS) {
  "use strict";

  function button(label, primary, onClick) {
    const btn = document.createElement("button");
    btn.className = "btn" + (primary ? " primary" : "");
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
  }

  function fatal(error) {
    console.error(error);
    const root = document.getElementById("app");
    if (!root) return;
    const storage = error && error.code === "storage-unavailable";
    root.className = "boot";
    root.innerHTML = "";
    const box = document.createElement("div");
    box.className = "boot-error";
    const title = document.createElement("h1");
    title.textContent = storage ? "Your projects could not be opened" : "Language Surface could not start";
    const text = document.createElement("p");
    text.textContent = storage
      ? "The browser did not give access to the storage that holds your projects. They have not been changed. Reloading usually fixes this; if you use private browsing or have blocked site data, allow it for this page first."
      : "Reloading usually fixes this. Your saved projects have not been changed. Details: " + ((error && error.message) || String(error));
    const actions = document.createElement("div");
    actions.className = "boot-actions";
    actions.appendChild(button("Reload", true, () => location.reload()));
    if (storage) actions.appendChild(button("Continue without my projects", false, () => boot({ allowFallback: true })));
    box.append(title, text, actions);
    root.appendChild(box);
  }

  let started = false;
  async function boot(opts) {
    if (started) return;
    try {
      const info = await LS.store.init(opts);
      started = true;
      LS.shell.start(document.getElementById("app"), info);
      document.documentElement.classList.add("ready");
    } catch (e) {
      fatal(e);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => boot());
  else boot();
})(globalThis.LS || (globalThis.LS = {}));
