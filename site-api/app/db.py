"""SQLite (WAL). Single process. Tables: slots, bookings, consult_requests, counters."""
from __future__ import annotations

import os
import sqlite3
import time
from typing import Any

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS slots (
  id INTEGER PRIMARY KEY,
  starts_at INTEGER NOT NULL,      -- unix ts
  duration_min INTEGER NOT NULL DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'open',  -- open|booked|held|past
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_slots_starts ON slots(starts_at);

CREATE TABLE IF NOT EXISTS consult_requests (
  id INTEGER PRIMARY KEY,
  ref TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  contact_telegram TEXT,
  company TEXT,
  service TEXT,                     -- rag|pdf|dispatcher|... or null
  process TEXT NOT NULL,
  slot_id INTEGER,
  slot_starts_at INTEGER,
  status TEXT NOT NULL DEFAULT 'received',  -- received|reviewing|scheduled|answered|closed
  next_step TEXT,
  ip_hash TEXT,
  ua_hash TEXT,
  locale TEXT NOT NULL DEFAULT 'en',
  page TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_requests_created ON consult_requests(created_at DESC);

CREATE TABLE IF NOT EXISTS counters (
  key TEXT PRIMARY KEY, window_id INTEGER NOT NULL, count INTEGER NOT NULL
);
"""


def serialize_f32(vec: list[float]) -> bytes:
    import struct
    return struct.pack(f"{len(vec)}f", *vec)


class DB:
    def __init__(self) -> None:
        os.makedirs(os.path.dirname(config.DB_PATH) or ".", exist_ok=True)
        self.conn = sqlite3.connect(config.DB_PATH, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    # ---------- slots ----------
    def list_open_slots(self, horizon: int = 0) -> list[dict[str, Any]]:
        cutoff = int(time.time()) + horizon
        rows = self.conn.execute(
            "SELECT * FROM slots WHERE status IN ('open','held') AND starts_at >= ? ORDER BY starts_at",
            (cutoff,),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_slot(self, slot_id: int) -> dict[str, Any] | None:
        row = self.conn.execute("SELECT * FROM slots WHERE id = ?", (slot_id,)).fetchone()
        return dict(row) if row else None

    def book_slot(self, slot_id: int) -> bool:
        """Atomically flip open->booked. Returns False if already taken."""
        now = int(time.time())
        cur = self.conn.execute(
            "UPDATE slots SET status='booked' WHERE id=? AND status IN ('open','held') AND starts_at >= ?",
            (slot_id, now),
        )
        self.conn.commit()
        return cur.rowcount == 1

    def add_slot(self, starts_at: int, duration_min: int = 30) -> int:
        cur = self.conn.execute(
            "INSERT INTO slots (starts_at, duration_min, created_at) VALUES (?,?,?)",
            (starts_at, duration_min, int(time.time())),
        )
        self.conn.commit()
        return cur.lastrowid

    def list_slots(self) -> list[dict[str, Any]]:
        rows = self.conn.execute("SELECT * FROM slots ORDER BY starts_at").fetchall()
        return [dict(r) for r in rows]

    def delete_slot(self, slot_id: int) -> bool:
        cur = self.conn.execute("DELETE FROM slots WHERE id = ? AND status IN ('open','held')", (slot_id,))
        self.conn.commit()
        return cur.rowcount == 1

    # ---------- consult_requests ----------
    def create_request(self, fields: dict[str, Any]) -> int:
        cols = ", ".join(fields.keys())
        ph = ", ".join("?" for _ in fields)
        now = int(time.time())
        values = list(fields.values())
        values.append(now)
        values.append(now)
        cur = self.conn.execute(
            f"INSERT INTO consult_requests ({cols}, created_at, updated_at) VALUES ({ph},?,?)",
            values,
        )
        self.conn.commit()
        return cur.lastrowid

    def get_request_by_ref(self, ref: str) -> dict[str, Any] | None:
        row = self.conn.execute("SELECT * FROM consult_requests WHERE ref = ?", (ref,)).fetchone()
        return dict(row) if row else None

    def has_email_recently(self, email: str, window_seconds: int = 1800) -> bool:
        cutoff = int(time.time()) - window_seconds
        row = self.conn.execute(
            "SELECT 1 FROM consult_requests WHERE email = ? AND created_at >= ? LIMIT 1",
            (email, cutoff),
        ).fetchone()
        return row is not None

    def list_requests(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT * FROM consult_requests ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]

    def set_request_status(self, ref: str, status: str, next_step: str | None = None) -> bool:
        cur = self.conn.execute(
            "UPDATE consult_requests SET status = ?, next_step = COALESCE(?, next_step), updated_at = ? WHERE ref = ?",
            (status, next_step, int(time.time()), ref),
        )
        self.conn.commit()
        return cur.rowcount == 1

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


db = DB()
