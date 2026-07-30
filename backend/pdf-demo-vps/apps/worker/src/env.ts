import type { BrowserWorker } from "@cloudflare/puppeteer";

export interface Env {
  KV: KVNamespace;
  R2: R2Bucket;
  MYBROWSER: BrowserWorker;
  RESEND_API_KEY: string;
  PUBLIC_BASE_URL: string;
}
