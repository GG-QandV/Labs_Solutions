/* theme-init.js — runs synchronously in <head> before first paint (no FOUC).
   Sets data-theme from saved preference, else system preference.
   Spec §7 (appearance). */
(function () {
  try {
    var saved = localStorage.getItem("aml-theme");
    var theme = saved;
    if (theme !== "dark" && theme !== "light") {
      theme = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
})();
