/* i18n.js — language controller (ES module). Spec §6.
   Loads i18n/<lang>.json at runtime and re-renders [data-i18n] / [data-i18n-attr].
   Default language: en (prerendered core text for SEO). */

export const SUPPORTED_LANGS = ["en", "uk", "pl", "ru"];
export const DEFAULT_LANG = "en";
const LANG_KEY = "aml-lang";

let dict = null;
let currentLang = DEFAULT_LANG;

export function getLang() { return currentLang; }

export async function loadLang(lang) {
  if (!SUPPORTED_LANGS.includes(lang)) lang = DEFAULT_LANG;
  const res = await fetch(`/i18n/${lang}.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`i18n load failed: ${res.status}`);
  dict = await res.json();
  currentLang = lang;
  try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
  document.documentElement.setAttribute("lang", lang);
  applyDict();
}

export function t(key, vars) {
  if (!dict) return key;
  let v = dict[key] ?? key;
  if (vars) {
    for (const [k, val] of Object.entries(vars)) {
      v = String(v).replace(new RegExp(`\\{${k}\\}`, "g"), String(val));
    }
  }
  return v;
}

function applyDict() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-attr]").forEach((el) => {
    const mapping = el.getAttribute("data-i18n-attr");
    for (const pair of mapping.split(",")) {
      const [attr, key] = pair.trim().split("=");
      if (attr && key) el.setAttribute(attr.trim(), t(key.trim()));
    }
  });
  document.querySelectorAll("[data-i18n-html]").forEach((el) => {
    el.innerHTML = t(el.getAttribute("data-i18n-html"));
  });
}

export function initI18n(initial) {
  const saved = localStorage.getItem(LANG_KEY);
  return loadLang(initial && SUPPORTED_LANGS.includes(initial) ? initial : (saved || DEFAULT_LANG));
}

export function bindLangSwitcher() {
  document.querySelectorAll("[data-lang]").forEach((btn) => {
    btn.addEventListener("click", () => {
      loadLang(btn.getAttribute("data-lang"));
    });
  });
}
