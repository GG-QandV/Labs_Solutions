import type { AppConfig, ColumnDef, PageFormat, ReportData, ValidationIssue, ValidationResult } from "@demo/report-schema";
import { parseCsv } from "./csv.ts";
import { detectColumnType, detectCellType, toDirectImageUrl } from "./detect.ts";

export { parseCsv } from "./csv.ts";
export { toDirectImageUrl, detectCellType, detectColumnType } from "./detect.ts";

const SHEET_ID_RE = /docs\.google\.com\/spreadsheets\/d\/([\w-]+)/;

export function sheetIdFromUrl(url: string): string | null {
  const m = url.match(SHEET_ID_RE);
  return m ? m[1] : null;
}

export function gvizCsvUrl(id: string): string {
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv`;
}
export function exportCsvUrl(id: string): string {
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`;
}

export interface FetchLike { (url: string, init?: RequestInit): Promise<Response>; }

async function fetchCsv(fetchFn: FetchLike, url: string): Promise<{ ok: boolean; status: number; text: string; contentType: string }> {
  try {
    const res = await fetchFn(url, { redirect: "follow", headers: { accept: "text/csv,*/*" } });
    const contentType = res.headers.get("content-type") ?? "";
    const text = res.ok ? await res.text() : "";
    return { ok: res.ok, status: res.status, text, contentType };
  } catch {
    return { ok: false, status: 0, text: "", contentType: "" };
  }
}

export interface ConnectResult {
  validation: ValidationResult;
  /** present only when validation.ok */
  report?: ReportData;
}

export interface ConnectOptions {
  sheetUrl: string;
  config: AppConfig;
  pageFormat: PageFormat;
  fetchFn?: FetchLike;
  /** rowIndex -> uploaded image URL (flow B overrides flow A) */
  uploadedImages?: Record<number, string>;
  /** probe image URLs with HEAD/GET (network-costly; on for validation) */
  probeImages?: boolean;
  meta?: Partial<ReportData["meta"]>;
}

/** The ONLY module that knows about Google Sheets. CSV link -> ReportData. */
export async function connectSheet(opts: ConnectOptions): Promise<ConnectResult> {
  const fetchFn: FetchLike = opts.fetchFn ?? ((u, i) => fetch(u, i));
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const stats = { rows: 0, columns: 0, imageCells: 0, brokenImages: 0, possiblyHiddenRows: -1, rowLimit: opts.config.rowLimit };

  const id = sheetIdFromUrl(opts.sheetUrl);
  if (!id) {
    errors.push({ code: "BAD_URL", message: "The link does not look like a Google Sheets URL." });
    return { validation: { ok: false, errors, warnings, stats } };
  }

  const gviz = await fetchCsv(fetchFn, gvizCsvUrl(id));
  if (!gviz.ok) {
    errors.push({
      code: "NOT_PUBLIC",
      message: "The sheet is not accessible. Share it as \u201cAnyone with the link\u201d and try again.",
      details: { status: gviz.status }
    });
    return { validation: { ok: false, errors, warnings, stats } };
  }
  if (/text\/html/i.test(gviz.contentType) || gviz.text.trimStart().startsWith("<")) {
    errors.push({ code: "NOT_CSV", message: "The sheet returned HTML instead of CSV \u2014 it is likely private or the link is wrong." });
    return { validation: { ok: false, errors, warnings, stats } };
  }

  let rows: string[][];
  try {
    rows = parseCsv(gviz.text);
  } catch (e) {
    errors.push({ code: "PARSE_ERROR", message: "Could not parse the sheet as CSV.", details: String(e) });
    return { validation: { ok: false, errors, warnings, stats } };
  }
  if (rows.length < 2) {
    errors.push({ code: "EMPTY", message: "The sheet needs a header row plus at least one data row." });
    return { validation: { ok: false, errors, warnings, stats } };
  }

  // Best-effort hidden rows check: gviz respects hidden rows sometimes; export does not.
  const exp = await fetchCsv(fetchFn, exportCsvUrl(id));
  if (exp.ok && !/text\/html/i.test(exp.contentType)) {
    try {
      const expRows = parseCsv(exp.text);
      const diff = expRows.length - rows.length;
      if (diff > 0) {
        stats.possiblyHiddenRows = diff;
        warnings.push({
          code: "HIDDEN_ROWS",
          message: `${diff} row(s) may be hidden in the source sheet and will not appear in the report.`,
          details: { visible: rows.length - 1, total: expRows.length - 1 }
        });
      } else stats.possiblyHiddenRows = 0;
    } catch { /* best effort */ }
  }

  const header = rows[0].map((h, i) => h.trim() || `Column ${i + 1}`);
  const dataRows = rows.slice(1).filter(r => r.some(v => v.trim() !== ""));
  stats.rows = dataRows.length;
  stats.columns = header.length;

  if (dataRows.length > opts.config.rowLimit) {
    errors.push({
      code: "TOO_MANY_ROWS",
      message: `The sheet has ${dataRows.length} data rows; the demo limit is ${opts.config.rowLimit} (\u2248 10 pages).`,
      details: { rows: dataRows.length, limit: opts.config.rowLimit }
    });
  }

  const columns: ColumnDef[] = header.map((h, i) => ({
    key: `col_${i}`,
    header: h,
    type: detectColumnType(dataRows.map(r => r[i] ?? ""))
  }));

  // Build blocks + probe images
  const blocks: ReportData["blocks"] = [];
  for (let r = 0; r < dataRows.length; r++) {
    const fields: ReportData["blocks"][number]["fields"] = [];
    for (let c = 0; c < columns.length; c++) {
      const col = columns[c];
      const raw = (dataRows[r][c] ?? "").trim();
      const field: (typeof fields)[number] = { key: col.key, header: col.header, type: col.type, raw };
      const isImage = col.type === "image" || (raw && detectCellType(raw) === "image");
      if (isImage && raw) {
        stats.imageCells++;
        field.type = "image";
        field.imageUrl = toDirectImageUrl(raw);
      }
      const uploaded = opts.uploadedImages?.[r];
      if (uploaded && isImage) {
        field.imageUrl = uploaded;
        field.imageUploaded = true;
        field.imageBroken = false;
      } else if (isImage && raw && opts.probeImages) {
        const alive = await probeImage(fetchFn, field.imageUrl!);
        if (!alive) {
          field.imageBroken = true;
          stats.brokenImages++;
          warnings.push({
            code: "BROKEN_IMAGE",
            message: `Row ${r + 1}: image link is not reachable \u2014 a placeholder will be used (or upload your own).`,
            details: { row: r, url: raw }
          });
        }
      }
      fields.push(field);
    }
    blocks.push({ index: r, fields });
  }

  const ok = errors.length === 0;
  const validation: ValidationResult = { ok, errors, warnings, stats };
  if (!ok) return { validation };

  const report: ReportData = {
    meta: {
      title: opts.meta?.title ?? "Your Company",
      reportNumber: opts.meta?.reportNumber ?? `R-${Date.now().toString(36).toUpperCase()}`,
      generatedAt: new Date().toISOString(),
      sourceLabel: "Google Sheet",
      pageFormat: opts.pageFormat,
      accentColor: opts.meta?.accentColor ?? "#0F5F5C",
      logoUrl: opts.meta?.logoUrl,
      lang: opts.meta?.lang ?? "en"
    },
    columns,
    blocks
  };
  return { validation, report };
}

async function probeImage(fetchFn: FetchLike, url: string): Promise<boolean> {
  try {
    let res = await fetchFn(url, { method: "HEAD", redirect: "follow" });
    if (res.status === 405 || res.status === 501) res = await fetchFn(url, { method: "GET", redirect: "follow" });
    if (!res.ok) return false;
    const ct = res.headers.get("content-type") ?? "";
    return ct === "" || ct.startsWith("image/") || ct === "application/octet-stream";
  } catch {
    return false;
  }
}
