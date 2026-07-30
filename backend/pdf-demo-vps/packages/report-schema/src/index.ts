/** Column data types the connector can auto-detect. */
export type ColumnType = "text" | "number" | "date" | "url" | "image";

export interface ColumnDef {
  key: string;
  header: string;
  type: ColumnType;
}

export interface FieldValue {
  key: string;
  header: string;
  type: ColumnType;
  raw: string;
  imageUrl?: string;
  imageUploaded?: boolean;
  imageBroken?: boolean;
}

/** One sheet row -> one PDF card. */
export interface ReportBlock {
  index: number;
  fields: FieldValue[];
}

/** Normalized internal format. The ONLY input the PDF engine accepts. */
export interface ReportData {
  meta: {
    title: string;
    reportNumber: string;
    generatedAt: string;
    sourceLabel: string;
    pageFormat: PageFormat;
    accentColor: string;
    logoUrl?: string;
    lang: string;
  };
  columns: ColumnDef[];
  blocks: ReportBlock[];
}

export type PageFormat = "A4" | "Legal";

export interface ValidationIssue {
  code: string;
  message: string;
  details?: unknown;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  stats: {
    rows: number;
    columns: number;
    imageCells: number;
    brokenImages: number;
    possiblyHiddenRows: number;
    rowLimit: number;
  };
}

export type JobStage = "pending" | "validating" | "rendering" | "sending" | "done" | "error";

export interface JobStatus {
  id: string;
  stage: JobStage;
  email?: string;
  pageFormat: PageFormat;
  sheetUrl: string;
  error?: { stage: Exclude<JobStage, "done">; message: string };
  simplifiedRendering?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AppConfig {
  rowLimit: number;
  maxImageBytes: number;
  tokenTtlSeconds: number;
  jobTtlSeconds: number;
  rateLimit: { perTokenPerHour: number; perIpPerHour: number; emailsPerDay: number };
  disposableDomains: string[];
}

export const DEFAULT_CONFIG: AppConfig = {
  rowLimit: 50,
  maxImageBytes: 5 * 1024 * 1024,
  tokenTtlSeconds: 3600,
  jobTtlSeconds: 24 * 3600,
  rateLimit: { perTokenPerHour: 5, perIpPerHour: 10, emailsPerDay: 90 },
  disposableDomains: ["mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.dev", "yopmail.com"]
};
