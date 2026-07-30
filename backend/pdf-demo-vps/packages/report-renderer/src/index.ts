import type { ReportData } from "@demo/report-schema";
import { templates } from "./templates.ts";
export { templates } from "./templates.ts";
export type { TemplateFn } from "./templates.ts";

export interface RenderOptions {
  template?: string;                 // "template-1" (default); add template-2 without touching pdf-engine
  imgProxy?: (url: string) => string;
}

export function renderHtml(data: ReportData, opts: RenderOptions = {}): string {
  const t = templates[opts.template ?? "template-1"];
  if (!t) throw new Error(`Unknown template: ${opts.template}`);
  return t(data, { imgProxy: opts.imgProxy ?? (u => u) });
}
