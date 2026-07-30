import puppeteer, { type BrowserWorker } from "@cloudflare/puppeteer";
import type { ReportData } from "@demo/report-schema";
import { renderHtml, type RenderOptions } from "@demo/report-renderer";
import { renderFallbackPdf } from "./fallback.ts";

export interface PdfResult {
  bytes: Uint8Array;
  /** true = Browser Rendering quota exhausted, pdf-lib simplified mode used */
  simplified: boolean;
}

export interface PdfEngineOptions extends RenderOptions {
  browser: BrowserWorker;          // MYBROWSER binding
}

/**
 * Renders ReportData -> PDF bytes.
 * Primary: Cloudflare Browser Rendering (page.pdf from HTML template).
 * Fallback on 429 (Free plan: 10 min/day): pdf-lib simplified rendering.
 */
export async function generatePdf(data: ReportData, opts: PdfEngineOptions): Promise<PdfResult> {
  try {
    const bytes = await renderWithBrowser(data, opts);
    return { bytes, simplified: false };
  } catch (err: unknown) {
    if (isQuotaError(err)) {
      const bytes = await renderFallbackPdf(data);
      return { bytes, simplified: true };
    }
    throw err;
  }
}

async function renderWithBrowser(data: ReportData, opts: PdfEngineOptions): Promise<Uint8Array> {
  const html = renderHtml(data, opts);
  const browser = await puppeteer.launch(opts.browser);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 20_000 });
    const isLegal = data.meta.pageFormat === "Legal";
    const pdf = await page.pdf({
      format: isLegal ? "legal" : "a4",
      printBackground: true,
      preferCSSPageSize: true
    });
    return new Uint8Array(pdf);
  } finally {
    // Close immediately: the 10 min/day Free budget is precious.
    await browser.close().catch(() => {});
  }
}

function isQuotaError(err: unknown): boolean {
  const s = String((err as Error)?.message ?? err);
  return s.includes("429") || /time limit exceeded/i.test(s) || /Browser time limit/i.test(s);
}
