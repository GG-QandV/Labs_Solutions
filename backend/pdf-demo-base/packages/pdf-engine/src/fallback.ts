import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { ReportData } from "@demo/report-schema";

const A4 = { w: 595.28, h: 841.89 };
const LEGAL = { w: 612, h: 1008 };

/** Simplified rendering: same card structure, no HTML/CSS, no remote images. */
export async function renderFallbackPdf(data: ReportData): Promise<Uint8Array> {
  const size = data.meta.pageFormat === "Legal" ? LEGAL : A4;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const margin = 48;
  const accent = hexToRgb(data.meta.accentColor);

  // Cover
  let page = doc.addPage([size.w, size.h]);
  page.drawText(data.meta.title, { x: margin, y: size.h - margin - 16, size: 12, font: bold, color: rgb(0.42, 0.45, 0.5) });
  page.drawText("Data Report", { x: margin, y: size.h / 2 + 20, size: 34, font: bold });
  page.drawRectangle({ x: margin, y: size.h / 2 - 2, width: 80, height: 3, color: accent });
  page.drawText(`${data.meta.reportNumber}  \u00b7  ${new Date(data.meta.generatedAt).toDateString()}  \u00b7  ${data.blocks.length} items  \u00b7  simplified rendering mode`,
    { x: margin, y: margin, size: 9, font, color: rgb(0.42, 0.45, 0.5) });

  // Cards
  let y = 0;
  const newPage = () => { page = doc.addPage([size.w, size.h]); y = size.h - margin; };
  newPage();
  for (const b of data.blocks) {
    const fields = b.fields.filter(f => f.raw.trim() !== "");
    const cardH = 26 + fields.length * 15;
    if (y - cardH < margin) newPage();
    page.drawRectangle({ x: margin, y: y - cardH, width: size.w - margin * 2, height: cardH, borderColor: rgb(0.9, 0.9, 0.92), borderWidth: 1 });
    page.drawText(String(b.index + 1).padStart(2, "0"), { x: size.w - margin - 24, y: y - 16, size: 8, font: bold, color: accent });
    let fy = y - 22;
    for (const f of fields) {
      const label = truncate(f.header.toUpperCase(), 28);
      const value = f.type === "image" ? "[image omitted in simplified mode]" : truncate(f.raw, 90);
      page.drawText(label, { x: margin + 10, y: fy, size: 6.5, font, color: rgb(0.42, 0.45, 0.5) });
      page.drawText(value, { x: margin + 130, y: fy, size: 9, font });
      fy -= 15;
    }
    y -= cardH + 12;
  }
  return doc.save();
}

function truncate(s: string, n: number): string { return s.length > n ? s.slice(0, n - 1) + "\u2026" : s; }
function hexToRgb(hex: string) {
  const m = hex.replace("#", "");
  const v = m.length === 3 ? m.split("").map(c => c + c).join("") : m.padEnd(6, "0");
  return rgb(parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255);
}
