/* theme.js — theme toggle controller (ES module). Spec §7.
   Also exposes the logo variant logic (dark/light logo swap). */

const THEME_KEY = "aml-theme";

export function getTheme() {
  return document.documentElement.getAttribute("data-theme") || "dark";
}

export function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  document.dispatchEvent(new CustomEvent("aml:themechange", { detail: { theme } }));
}

export function toggleTheme() {
  const next = getTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}

export function initThemeToggle() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;

  const sunIco = btn.querySelector('[data-ico="sun"]');
  const moonIco = btn.querySelector('[data-ico="moon"]');

  function sync(theme) {
    const isDark = theme === "dark";
    if (sunIco) sunIco.style.display = isDark ? "none" : "inline-block";
    if (moonIco) moonIco.style.display = isDark ? "inline-block" : "none";
    btn.setAttribute("aria-label", isDark ? "Switch to light theme" : "Switch to dark theme");
  }

  btn.addEventListener("click", () => sync(toggleTheme()));
  document.addEventListener("aml:themechange", (e) => sync(e.detail.theme));
  sync(getTheme());
}
