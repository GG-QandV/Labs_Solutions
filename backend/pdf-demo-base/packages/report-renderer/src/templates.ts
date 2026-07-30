import type { ReportData } from "@demo/report-schema";

export type TemplateFn = (d: ReportData, opts: { imgProxy: (url: string) => string }) => string;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * template-1: minimal, brandable. Cover + repeating cards.
 * Adding template-2 = add a new TemplateFn here; the PDF engine never changes.
 */
export const template1: TemplateFn = (d, { imgProxy }) => {
  const pageSize = d.meta.pageFormat === "Legal" ? "8.5in 14in" : "A4";
  const date = new Date(d.meta.generatedAt).toLocaleDateString(d.meta.lang, { year: "numeric", month: "long", day: "numeric" });

  const cards = d.blocks.map(b => {
    const imgField = b.fields.find(f => f.type === "image" && f.imageUrl && !f.imageBroken);
    const brokenImg = b.fields.find(f => f.type === "image" && (f.imageBroken || (!f.imageUrl && f.raw)));
    const textFields = b.fields.filter(f => f.type !== "image" && f.raw.trim() !== "");
    const media = imgField
      ? `<figure class="card-media"><img src="${esc(imgProxy(imgField.imageUrl!))}" alt=""></figure>`
      : brokenImg
        ? `<figure class="card-media card-media--missing"><span>image unavailable</span></figure>`
        : "";
    const rows = textFields.map(f => `
        <div class="field">
          <dt>${esc(f.header)}</dt>
          <dd class="v-${f.type}">${esc(f.raw)}</dd>
        </div>`).join("");
    return `
      <article class="card">
        <header class="card-head"><span class="card-no">${String(b.index + 1).padStart(2, "0")}</span></header>
        ${media}
        <dl class="card-fields">${rows}</dl>
      </article>`;
  }).join("\n");

  return `<!doctype html>
<html lang="${esc(d.meta.lang)}">
<head>
<meta charset="utf-8">
<style>
  :root {
    --accent: ${esc(d.meta.accentColor)};
    --ink: #1c1f22;
    --muted: #6b7280;
    --line: #e5e7eb;
    --paper: #ffffff;
  }
  @page { size: ${pageSize}; margin: 18mm 16mm; }
  * { box-sizing: border-box; margin: 0; }
  html, body { background: var(--paper); color: var(--ink);
    font: 10.5pt/1.55 "Georgia", "Times New Roman", serif; }
  .sans { font-family: "Helvetica Neue", Arial, sans-serif; }

  /* Cover */
  .cover { height: calc(100vh - 0mm); display: flex; flex-direction: column;
    justify-content: space-between; page-break-after: always; }
  .cover-top { display: flex; align-items: center; gap: 10mm; padding-top: 8mm; }
  .logo { width: 34mm; height: 34mm; border: 1px dashed var(--line); border-radius: 4px;
    display: flex; align-items: center; justify-content: center;
    color: var(--muted); font-family: Arial, sans-serif; font-size: 8pt; overflow: hidden; }
  .logo img { width: 100%; height: 100%; object-fit: contain; }
  .company { font-family: Arial, sans-serif; font-size: 13pt; letter-spacing: .14em;
    text-transform: uppercase; color: var(--muted); }
  .cover-title { font-size: 34pt; line-height: 1.15; max-width: 80%; }
  .cover-title em { font-style: normal; color: var(--accent); }
  .cover-rule { width: 28mm; height: 3px; background: var(--accent); margin: 10mm 0 6mm; }
  .cover-meta { font-family: Arial, sans-serif; font-size: 9pt; color: var(--muted);
    display: flex; gap: 12mm; padding-bottom: 10mm; }
  .cover-meta b { color: var(--ink); font-weight: 600; display: block; }

  /* Cards */
  .cards { display: block; }
  .card { break-inside: avoid; border: 1px solid var(--line); border-radius: 6px;
    padding: 6mm; margin-bottom: 6mm; }
  .card-head { display: flex; justify-content: flex-end; margin-bottom: 3mm; }
  .card-no { font-family: Arial, sans-serif; font-size: 8pt; color: var(--accent);
    letter-spacing: .12em; }
  .card-media { width: 100%; height: 52mm; display: flex; align-items: center;
    justify-content: center; background: #fafafa; border-radius: 4px; margin-bottom: 4mm;
    overflow: hidden; }
  .card-media img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .card-media--missing span { font-family: Arial, sans-serif; font-size: 8.5pt;
    color: var(--muted); border: 1px dashed var(--line); padding: 2mm 4mm; border-radius: 3px; }
  .card-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm 8mm; }
  .field dt { font-family: Arial, sans-serif; font-size: 7.5pt; letter-spacing: .1em;
    text-transform: uppercase; color: var(--muted); margin-bottom: .5mm; }
  .field dd { font-size: 10pt; word-break: break-word; }
  .v-number { font-variant-numeric: tabular-nums; }
  .v-url { color: var(--accent); font-size: 9pt; }
</style>
</head>
<body>
  <section class="cover">
    <div>
      <div class="cover-top">
        <div class="logo">${d.meta.logoUrl ? `<img src="${esc(imgProxy(d.meta.logoUrl))}" alt="logo">` : "your logo"}</div>
        <div class="company">${esc(d.meta.title)}</div>
      </div>
      <div class="cover-rule"></div>
      <h1 class="cover-title">Data <em>Report</em></h1>
    </div>
    <div class="cover-meta">
      <div><b>Date</b>${esc(date)}</div>
      <div><b>Report</b>${esc(d.meta.reportNumber)}</div>
      <div><b>Source</b>${esc(d.meta.sourceLabel)}</div>
      <div><b>Items</b>${d.blocks.length}</div>
    </div>
  </section>
  <section class="cards">${cards}</section>
</body>
</html>`;
};

export const templates: Record<string, TemplateFn> = { "template-1": template1 };
