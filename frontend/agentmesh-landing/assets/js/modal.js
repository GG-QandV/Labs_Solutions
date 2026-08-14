/* modal.js — accessible modal controller (ES module). Spec §5 (wizard). */

let focusTrap = null;

export function openModal(overlayId) {
  const overlay = document.getElementById(overlayId);
  if (!overlay) return;
  overlay.classList.add("open");
  document.body.style.overflow = "hidden";

  const first = overlay.querySelector('[data-autofocus]') || overlay.querySelector("button");
  focusTrap = first;
  if (first) first.focus();

  overlay.addEventListener("keydown", onKeydown);
}

export function closeModal(overlayId) {
  const overlay = document.getElementById(overlayId);
  if (!overlay) return;
  overlay.classList.remove("open");
  document.body.style.overflow = "";
  overlay.removeEventListener("keydown", onKeydown);
}

function onKeydown(e) {
  if (e.key === "Escape") {
    const open = document.querySelector(".modal-overlay.open");
    if (open) closeModal(open.id);
  }
}

export function initModals() {
  document.querySelectorAll("[data-modal-open]").forEach((trigger) => {
    trigger.addEventListener("click", () => openModal(trigger.getAttribute("data-modal-open")));
  });
  document.querySelectorAll("[data-modal-close]").forEach((trigger) => {
    trigger.addEventListener("click", () => {
      const overlay = trigger.closest(".modal-overlay");
      if (overlay) closeModal(overlay.id);
    });
  });
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });
}
