import Database from "better-sqlite3";
import type { KVLike } from "@demo/access-token";
import type { JobStatus } from "@demo/report-schema";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** SQLite-backed storage: KVLike (tokens, rate-limits) + jobs. Single writer = this process. */
export class Store implements KVLike {
  private db: Database.Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, expires_at INTEGER);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_jobs_updated ON jobs(updated_at);
    `);
  }

  async get(key: string): Promise<string | null> {
    const row = this.db.prepare("SELECT v, expires_at FROM kv WHERE k = ?").get(key) as { v: string; expires_at: number | null } | undefined;
    if (!row) return null;
    if (row.expires_at !== null && row.expires_at < Date.now()) {
      this.db.prepare("DELETE FROM kv WHERE k = ?").run(key);
      return null;
    }
    return row.v;
  }

  async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
    const exp = opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : null;
    this.db.prepare("INSERT INTO kv (k, v, expires_at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, expires_at = excluded.expires_at").run(key, value, exp);
  }

  saveJob(job: JobStatus): void {
    this.db.prepare("INSERT INTO jobs (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
      .run(job.id, JSON.stringify(job), Date.now());
  }

  getJob(id: string): JobStatus | null {
    const row = this.db.prepare("SELECT data FROM jobs WHERE id = ?").get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : null;
  }

  /** Daily housekeeping: expired kv + jobs older than ttl. */
  cleanup(jobTtlSeconds: number): void {
    this.db.prepare("DELETE FROM kv WHERE expires_at IS NOT NULL AND expires_at < ?").run(Date.now());
    this.db.prepare("DELETE FROM jobs WHERE updated_at < ?").run(Date.now() - jobTtlSeconds * 1000);
  }
}
