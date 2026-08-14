/* clipboard.js — copy-to-clipboard helper (ES module).
   Spec §11: token is shown once and copyable; after the first copy the
   raw bearer value must not remain on screen. */

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    // fallback for non-secure contexts
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
    ta.remove();
    return ok;
  }
}

export function bindCopyButtons() {
  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const target = document.querySelector(btn.getAttribute("data-copy"));
      if (!target) return;
      const value = target.textContent.trim();
      const ok = await copyText(value);
      btn.classList.add("copied");
      const label = btn.querySelector(".copy-label");
      if (label) label.textContent = ok ? "Copied" : "Copy failed";
      setTimeout(() => {
        btn.classList.remove("copied");
        if (label) label.textContent = btn.getAttribute("data-label") || "Copy";
      }, 1600);
    });
  });
}
