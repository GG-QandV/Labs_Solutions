"""SQLite (WAL) + sqlite-vec. One writer process. Every query is tenant-scoped."""
from __future__ import annotations

import json
import os
import sqlite3
import struct
import time
from typing import Any

import sqlite_vec

from . import config

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, confirmed INTEGER DEFAULT 0,
  confirm_token TEXT, tenant_id TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id INTEGER,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  cleanup_postponed_until INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, filename TEXT NOT NULL,
  pages INTEGER DEFAULT 0, status TEXT DEFAULT 'pending',   -- pending|extracting|indexing|ready|error
  error TEXT, path TEXT, ocr_used INTEGER DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_docs_tenant ON documents(tenant_id);
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, document_id INTEGER NOT NULL,
  filename TEXT NOT NULL, page INTEGER, chunk_index INTEGER, text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_tenant ON chunks(tenant_id);
CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
  chunk_id INTEGER PRIMARY KEY, embedding float[{config.EMBED_DIM}]
);
CREATE TABLE IF NOT EXISTS chat_history (
  id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, user_id INTEGER,
  question TEXT NOT NULL, answer TEXT, sources_json TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS counters (
  key TEXT PRIMARY KEY, window_id INTEGER NOT NULL, count INTEGER NOT NULL
);
"""


def serialize_f32(vec: list[float]) -> bytes:
    return struct.pack(f"{len(vec)}f", *vec)


class DB:
    def __init__(self) -> None:
        os.makedirs(os.path.dirname(config.DB_PATH) or ".", exist_ok=True)
        os.makedirs(config.FILES_DIR, exist_ok=True)
        self.conn = sqlite3.connect(config.DB_PATH, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.enable_load_extension(True)
        sqlite_vec.load(self.conn)
        self.conn.enable_load_extension(False)
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    # ---------- sessions ----------
    def create_session(self, token: str, tenant_id: str, user_id: int | None = None) -> dict[str, Any]:
        now = int(time.time())
        exp = now + config.SESSION_TTL_SECONDS
        self.conn.execute(
            "INSERT INTO sessions (token, tenant_id, user_id, created_at, expires_at) VALUES (?,?,?,?,?)",
            (token, tenant_id, user_id, now, exp),
        )
        self.conn.commit()
        return {"token": token, "tenant_id": tenant_id, "expires_at": exp * 1000}

    def get_session(self, token: str | None) -> dict[str, Any] | None:
        if not token:
            return None
        row = self.conn.execute("SELECT * FROM sessions WHERE token = ?", (token,)).fetchone()
        if not row or row["expires_at"] < time.time():
            return None
        return dict(row)

    def postpone_cleanup(self, token: str, until_ts: int) -> None:
        self.conn.execute("UPDATE sessions SET cleanup_postponed_until = ? WHERE token = ?", (until_ts, token))
        self.conn.commit()

    # ---------- users ----------
    def create_user(self, email: str, tenant_id: str, confirm_token: str) -> int:
        cur = self.conn.execute(
            "INSERT INTO users (email, confirmed, confirm_token, tenant_id, created_at) VALUES (?,0,?,?,?) "
            "ON CONFLICT(email) DO UPDATE SET confirm_token=excluded.confirm_token",
            (email, confirm_token, tenant_id, int(time.time())),
        )
        self.conn.commit()
        row = self.conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        return row["id"] if row else cur.lastrowid

    def confirm_user(self, confirm_token: str) -> dict[str, Any] | None:
        row = self.conn.execute("SELECT * FROM users WHERE confirm_token = ?", (confirm_token,)).fetchone()
        if not row:
            return None
        self.conn.execute("UPDATE users SET confirmed = 1, confirm_token = NULL WHERE id = ?", (row["id"],))
        self.conn.commit()
        return dict(row)

    # ---------- documents & chunks ----------
    def add_document(self, tenant_id: str, filename: str, path: str) -> int:
        cur = self.conn.execute(
            "INSERT INTO documents (tenant_id, filename, status, path, created_at) VALUES (?,?,'pending',?,?)",
            (tenant_id, filename, path, int(time.time())),
        )
        self.conn.commit()
        return cur.lastrowid

    def set_document(self, doc_id: int, **fields: Any) -> None:
        keys = ", ".join(f"{k} = ?" for k in fields)
        self.conn.execute(f"UPDATE documents SET {keys} WHERE id = ?", (*fields.values(), doc_id))
        self.conn.commit()

    def list_documents(self, tenant_id: str) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT id, filename, pages, status, error, ocr_used FROM documents WHERE tenant_id IN (?, ?) ORDER BY id",
            (tenant_id, config.PUBLIC_TENANT),
        ).fetchall()
        return [dict(r) for r in rows]

    def tenant_usage(self, tenant_id: str) -> dict[str, int]:
        row = self.conn.execute(
            "SELECT COUNT(*) AS files, COALESCE(SUM(pages),0) AS pages FROM documents WHERE tenant_id = ?",
            (tenant_id,),
        ).fetchone()
        return {"files": row["files"], "pages": row["pages"]}

    def add_chunks(self, tenant_id: str, doc_id: int, filename: str,
                   chunks: list[tuple[int, int, str]], embeddings: list[list[float]]) -> int:
        now = int(time.time())
        for (page, idx, text), emb in zip(chunks, embeddings, strict=True):
            cur = self.conn.execute(
                "INSERT INTO chunks (tenant_id, document_id, filename, page, chunk_index, text, created_at) "
                "VALUES (?,?,?,?,?,?,?)",
                (tenant_id, doc_id, filename, page, idx, text, now),
            )
            self.conn.execute(
                "INSERT INTO vec_chunks (chunk_id, embedding) VALUES (?, ?)",
                (cur.lastrowid, serialize_f32(emb)),
            )
        self.conn.commit()
        return len(chunks)

    def search(self, tenant_id: str, query_emb: list[float], k: int) -> list[dict[str, Any]]:
        """Vector KNN restricted to the tenant (+ public demo set)."""
        rows = self.conn.execute(
            """
            SELECT c.id, c.filename, c.page, c.chunk_index, c.text, v.distance
            FROM vec_chunks v JOIN chunks c ON c.id = v.chunk_id
            WHERE v.embedding MATCH ? AND k = ? AND c.tenant_id IN (?, ?)
            ORDER BY v.distance
            """,
            (serialize_f32(query_emb), k * 4, tenant_id, config.PUBLIC_TENANT),
        ).fetchall()
        out = []
        for r in rows[:k]:
            d = dict(r)
            d["score"] = 1.0 - float(d.pop("distance")) / 2.0  # L2 on normalized vectors -> cosine-ish
            out.append(d)
        return out

    def save_chat(self, tenant_id: str, user_id: int | None, question: str, answer: str, sources: Any) -> None:
        if user_id is None:  # anonymous demo: no history stored
            return
        self.conn.execute(
            "INSERT INTO chat_history (tenant_id, user_id, question, answer, sources_json, created_at) VALUES (?,?,?,?,?,?)",
            (tenant_id, user_id, question, answer, json.dumps(sources), int(time.time())),
        )
        self.conn.commit()

    def history(self, user_id: int, limit: int = 20) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT question, answer, sources_json, created_at FROM chat_history WHERE user_id = ? ORDER BY id DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]

    # ---------- counters (rate limits) ----------
    def bump(self, key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
        now = int(time.time())
        window_id = now // window_seconds
        row = self.conn.execute("SELECT window_id, count FROM counters WHERE key = ?", (key,)).fetchone()
        count = row["count"] if row and row["window_id"] == window_id else 0
        resets_in = (window_id + 1) * window_seconds - now
        if count >= limit:
            return False, resets_in
        self.conn.execute(
            "INSERT INTO counters (key, window_id, count) VALUES (?,?,?) "
            "ON CONFLICT(key) DO UPDATE SET window_id=excluded.window_id, count=excluded.count",
            (key, window_id, count + 1),
        )
        self.conn.commit()
        return True, resets_in

    # ---------- cleanup ----------
    def tenants_to_wipe(self, now: int) -> list[str]:
        """Anonymous tenants whose session expired and cleanup is not postponed;
        registered tenants older than the retention window."""
        rows = self.conn.execute(
            "SELECT DISTINCT tenant_id FROM sessions WHERE user_id IS NULL AND cleanup_postponed_until < ?",
            (now,),
        ).fetchall()
        anon = [r["tenant_id"] for r in rows]
        cutoff = now - config.REGISTERED_RETENTION_DAYS * 86400
        rows = self.conn.execute(
            "SELECT DISTINCT tenant_id FROM documents WHERE created_at < ? AND tenant_id != ?",
            (cutoff, config.PUBLIC_TENANT),
        ).fetchall()
        return [t for t in {*anon, *[r["tenant_id"] for r in rows]} if t != config.PUBLIC_TENANT]

    def wipe_tenant(self, tenant_id: str) -> dict[str, int]:
        if tenant_id == config.PUBLIC_TENANT:
            return {"chunks": 0, "documents": 0}
        ids = [r["id"] for r in self.conn.execute("SELECT id FROM chunks WHERE tenant_id = ?", (tenant_id,)).fetchall()]
        for cid in ids:
            self.conn.execute("DELETE FROM vec_chunks WHERE chunk_id = ?", (cid,))
        self.conn.execute("DELETE FROM chunks WHERE tenant_id = ?", (tenant_id,))
        paths = [r["path"] for r in self.conn.execute("SELECT path FROM documents WHERE tenant_id = ?", (tenant_id,)).fetchall()]
        n_docs = self.conn.execute("DELETE FROM documents WHERE tenant_id = ?", (tenant_id,)).rowcount
        self.conn.execute("DELETE FROM sessions WHERE tenant_id = ?", (tenant_id,))
        self.conn.commit()
        for p in paths:
            try:
                if p and os.path.exists(p):
                    os.remove(p)
            except OSError:
                pass
        return {"chunks": len(ids), "documents": n_docs}


db = DB()
