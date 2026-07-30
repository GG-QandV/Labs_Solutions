import type { ColumnType } from "@demo/report-schema";

const IMG_EXT_RE = /\.(png|jpe?g|webp)(\?.*)?$/i;
const DRIVE_FILE_RE = /drive\.google\.com\/(?:file\/d\/([\w-]+)|open\?id=([\w-]+)|uc\?(?:export=\w+&)?id=([\w-]+))/i;
const URL_RE = /^https?:\/\/\S+$/i;
const NUM_RE = /^-?\d+(?:[.,]\d+)?$/;
const DATE_RE = /^(\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{2,4})$/;

export function driveIdFrom(url: string): string | null {
  const m = url.match(DRIVE_FILE_RE);
  return m ? (m[1] || m[2] || m[3]) : null;
}

/** Convert a Google Drive share link into a credential-free image URL. */
export function toDirectImageUrl(url: string): string {
  const id = driveIdFrom(url);
  if (id) return `https://drive.google.com/thumbnail?id=${id}&sz=w2000`;
  return url;
}

export function detectCellType(v: string): ColumnType {
  const s = v.trim();
  if (!s) return "text";
  if (URL_RE.test(s)) {
    if (IMG_EXT_RE.test(s) || DRIVE_FILE_RE.test(s)) return "image";
    return "url";
  }
  if (NUM_RE.test(s)) return "number";
  if (DATE_RE.test(s)) return "date";
  return "text";
}

/** Majority vote over sample values; image/url win if present in >=30% of non-empty cells. */
export function detectColumnType(values: string[]): ColumnType {
  const nonEmpty = values.map(v => v.trim()).filter(Boolean);
  if (!nonEmpty.length) return "text";
  const counts: Record<ColumnType, number> = { text: 0, number: 0, date: 0, url: 0, image: 0 };
  for (const v of nonEmpty) counts[detectCellType(v)]++;
  if (counts.image / nonEmpty.length >= 0.3) return "image";
  if (counts.url / nonEmpty.length >= 0.3) return "url";
  let best: ColumnType = "text", bestN = -1;
  (Object.keys(counts) as ColumnType[]).forEach(t => { if (counts[t] > bestN) { best = t; bestN = counts[t]; } });
  return best;
}
