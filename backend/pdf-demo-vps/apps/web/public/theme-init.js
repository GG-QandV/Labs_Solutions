/* theme-init.js — pre-paint: применяет тему ДО первого рендера (анти-FOUC).
   Ключ localStorage: pdf.theme. */
(function () {
  try {
    var saved = localStorage.getItem("pdf.theme");
    var theme = saved === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) { /* localStorage недоступен — дефолт dark */ }
})();
