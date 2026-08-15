/* app.js — application entry point (ES module). Spec §8.
   Orchestrates modules: theme, i18n, modals, clipboard, demo wizard,
   hero connection map pulse, nav toggle, scroll reveal, year. */

import { initThemeToggle } from "./theme.js?v=4d3b0215ad";
import { initI18n, bindLangSwitcher } from "./i18n.js?v=9e24e4aeee";
import { initModals } from "./modal.js?v=ca1d18f48d";
import { bindCopyButtons } from "./clipboard.js?v=79c12c9348";
import { initDemoWizard } from "./demo-wizard.js?v=09bfe31b1a";
import { renderConnectionMap } from "./connection-map.js?v=6b5b79e6cc";
import { probeBackend } from "./api-client.js?v=2b4b02e423";

async function init() {
  // static hero connection map (preview card)
  renderConnectionMap(document.getElementById("hero-conn-map"), null);

  // backend availability probe (async, non-blocking) — drives mock/live mode
  probeBackend().then(() => {
    initDemoWizard();
  });

  initThemeToggle();
  bindCopyButtons();
  initModals();
  initNav();
  initReveal();
  initYear();

  const langFromPath = detectLangFromPath();
  try {
    await initI18n(langFromPath);
  } catch (e) {
    // non-critical — prerendered English core text stays visible
  }
  bindLangSwitcher();
}

function detectLangFromPath() {
  const seg = location.pathname.split("/").filter(Boolean)[0];
  return ["en", "uk", "pl", "ru"].includes(seg) ? seg : null;
}

function initNav() {
  const toggle = document.getElementById("nav-toggle");
  const nav = document.querySelector(".main-nav");
  if (!toggle || !nav) return;
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
}

function initReveal() {
  const els = document.querySelectorAll("[data-reveal]");
  if (!els.length) return;
  if (!("IntersectionObserver" in window)) { els.forEach((el) => el.classList.add("revealed")); return; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("revealed"); io.unobserve(e.target); }
    });
  }, { threshold: 0.12 });
  els.forEach((el) => io.observe(el));
}

function initYear() {
  const y = document.getElementById("year");
  if (y) y.textContent = String(new Date().getFullYear());
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
