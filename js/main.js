/* Language Surface — boot. */
(function (LS) {
  "use strict";

  function fatal(error) {
    console.error(error);
    const root = document.getElementById("app");
    if (!root) return;
    root.className = "boot";
    root.innerHTML = "";
    const box = document.createElement("div");
    box.className = "boot-error";
    const title = document.createElement("h1");
    title.textContent = "Language Surface could not start";
    const text = document.createElement("p");
    text.textContent = "Reloading usually fixes this. Your saved projects are not affected. Details: " + ((error && error.message) || String(error));
    const btn = document.createElement("button");
    btn.className = "btn primary";
    btn.textContent = "Reload";
    btn.addEventListener("click", () => location.reload());
    box.append(title, text, btn);
    root.appendChild(box);
  }

  async function boot() {
    try {
      const info = await LS.store.init();
      LS.shell.start(document.getElementById("app"), info);
      document.documentElement.classList.add("ready");
    } catch (e) {
      fatal(e);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(globalThis.LS || (globalThis.LS = {}));
