import { chromium, type Browser } from "playwright-core";
import type { ReportData } from "@demo/report-schema";
import { renderHtml, type RenderOptions } from "@demo/report-renderer";

export interface PdfResult { bytes: Uint8Array }

export interface PdfEngineOptions extends RenderOptions {
  /** Path to system Chromium (in Docker: /usr/bin/chromium). */
  executablePath?: string;
  timeoutMs?: number;
}

/**
 * ReportData -> PDF bytes via local Chromium (Playwright).
 * A browser is launched per job and closed immediately: with queue concurrency 2
 * this keeps peak RAM bounded (~2x400-500 MB) and avoids leak accumulation
 * (VPS-level protection: container mem_limit + restart: on-failure).
 */
export async function generatePdf(data: ReportData, opts: PdfEngineOptions = {}): Promise<PdfResult> {
  const html = renderHtml(data, opts);
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      executablePath: opts.executablePath ?? process.env.CHROMIUM_PATH ?? undefined,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle", timeout: opts.timeoutMs ?? 30_000 });
    const isLegal = data.meta.pageFormat === "Legal";
    const pdf = await page.pdf({
      format: isLegal ? "Legal" : "A4",
      printBackground: true,
      preferCSSPageSize: true
    });
    return { bytes: new Uint8Array(pdf) };
  } finally {
    await browser?.close().catch(() => {});
  }
}
