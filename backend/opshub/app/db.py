"""OpsHub DB layer: SQLite (WAL), single-writer process. Schema per OpsHub v1 spec."""
from __future__ import annotations

import json
import os
import time
from typing import Any

import aiosqlite

DB_PATH = os.environ.get("OPSHUB_DB", "/data/opshub.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  container_name TEXT NOT NULL,
  url_health TEXT,
  domain TEXT,
  autostop_minutes INTEGER DEFAULT 30,
  restart_cron TEXT DEFAULT '0 4 * * *',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  service TEXT NOT NULL,
  level TEXT NOT NULL,          -- error|critical
  event TEXT NOT NULL,          -- error|crash|oom|restart|health_fail|...
  message TEXT NOT NULL,
  traceback TEXT,
  request_id TEXT,
  meta_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_logs_service_ts ON logs(service, ts);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  service TEXT NOT NULL,
  kind TEXT NOT NULL,           -- start|stop|die|oom|health_fail|restart_scheduled|autostop
  detail_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_service_ts ON events(service, ts);
CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  service TEXT NOT NULL,
  mem_mb REAL,
  cpu_pct REAL,
  disk_data_mb REAL
);
CREATE INDEX IF NOT EXISTS idx_metrics_service_ts ON metrics(service, ts);
CREATE TABLE IF NOT EXISTS heartbeats (
  service TEXT PRIMARY KEY,
  ts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  login TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);
"""

LOG_RETENTION_DAYS = int(os.environ.get("LOG_RETENTION_DAYS", "30"))
METRIC_RETENTION_DAYS = int(os.environ.get("METRIC_RETENTION_DAYS", "7"))


class DB:
    def __init__(self) -> None:
        self.conn: aiosqlite.Connection | None = None

    async def open(self) -> None:
        os.makedirs(os.path.dirname(DB_PATH) or ".", exist_ok=True)
        self.conn = await aiosqlite.connect(DB_PATH)
        self.conn.row_factory = aiosqlite.Row
        await self.conn.execute("PRAGMA journal_mode=WAL")
        await self.conn.executescript(SCHEMA)
        await self.conn.commit()

    async def close(self) -> None:
        if self.conn:
            await self.conn.close()

    # ---- services ----
    async def register_service(self, name: str, container_name: str, url_health: str | None) -> None:
        await self.conn.execute(
            """INSERT INTO services (name, container_name, url_health, created_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(name) DO UPDATE SET container_name=excluded.container_name,
                 url_health=COALESCE(excluded.url_health, services.url_health)""",
            (name, container_name, url_health, int(time.time())),
        )
        await self.conn.commit()

    async def list_services(self) -> list[dict[str, Any]]:
        cur = await self.conn.execute("SELECT * FROM services ORDER BY name")
        return [dict(r) for r in await cur.fetchall()]

    async def get_service(self, name: str) -> dict[str, Any] | None:
        cur = await self.conn.execute("SELECT * FROM services WHERE name = ?", (name,))
        row = await cur.fetchone()
        return dict(row) if row else None

    # ---- logs ----
    async def add_logs(self, entries: list[dict[str, Any]]) -> int:
        now = int(time.time())
        rows = [
            (
                e.get("ts", now), e["service"], e["level"], e.get("event", "error"),
                str(e.get("message", ""))[:4000], (e.get("traceback") or "")[:16000] or None,
                e.get("request_id"), json.dumps(e.get("meta")) if e.get("meta") else None,
            )
            for e in entries
        ]
        await self.conn.executemany(
            "INSERT INTO logs (ts, service, level, event, message, traceback, request_id, meta_json) VALUES (?,?,?,?,?,?,?,?)",
            rows,
        )
        await self.conn.commit()
        return len(rows)

    async def query_logs(self, service: str | None, level: str | None, since: int | None, limit: int) -> list[dict[str, Any]]:
        q = "SELECT * FROM logs WHERE 1=1"
        args: list[Any] = []
        if service:
            q += " AND service = ?"; args.append(service)
        if level:
            q += " AND level = ?"; args.append(level)
        if since:
            q += " AND ts >= ?"; args.append(since)
        q += " ORDER BY ts DESC LIMIT ?"; args.append(min(limit, 500))
        cur = await self.conn.execute(q, args)
        return [dict(r) for r in await cur.fetchall()]

    # ---- events / metrics / heartbeats ----
    async def add_event(self, service: str, kind: str, detail: dict[str, Any] | None = None) -> None:
        await self.conn.execute(
            "INSERT INTO events (ts, service, kind, detail_json) VALUES (?,?,?,?)",
            (int(time.time()), service, kind, json.dumps(detail) if detail else None),
        )
        await self.conn.commit()

    async def add_metric(self, service: str, mem_mb: float, cpu_pct: float, disk_data_mb: float) -> None:
        await self.conn.execute(
            "INSERT INTO metrics (ts, service, mem_mb, cpu_pct, disk_data_mb) VALUES (?,?,?,?,?)",
            (int(time.time()), service, mem_mb, cpu_pct, disk_data_mb),
        )
        await self.conn.commit()

    async def metrics_sparkline(self, service: str, hours: int = 24) -> list[dict[str, Any]]:
        since = int(time.time()) - hours * 3600
        cur = await self.conn.execute(
            "SELECT ts, mem_mb, cpu_pct FROM metrics WHERE service=? AND ts>=? ORDER BY ts",
            (service, since),
        )
        return [dict(r) for r in await cur.fetchall()]

    async def heartbeat(self, service: str) -> None:
        await self.conn.execute(
            "INSERT INTO heartbeats (service, ts) VALUES (?, ?) ON CONFLICT(service) DO UPDATE SET ts=excluded.ts",
            (service, int(time.time())),
        )
        await self.conn.commit()

    async def last_heartbeat(self, service: str) -> int | None:
        cur = await self.conn.execute("SELECT ts FROM heartbeats WHERE service = ?", (service,))
        row = await cur.fetchone()
        return row["ts"] if row else None

    # ---- users ----
    async def get_user(self, login: str) -> dict[str, Any] | None:
        cur = await self.conn.execute("SELECT * FROM users WHERE login = ?", (login,))
        row = await cur.fetchone()
        return dict(row) if row else None

    async def upsert_user(self, login: str, password_hash: str) -> None:
        await self.conn.execute(
            "INSERT INTO users (login, password_hash) VALUES (?, ?) ON CONFLICT(login) DO UPDATE SET password_hash=excluded.password_hash",
            (login, password_hash),
        )
        await self.conn.commit()

    # ---- rotation ----
    async def rotate(self) -> None:
        now = int(time.time())
        await self.conn.execute("DELETE FROM logs WHERE ts < ?", (now - LOG_RETENTION_DAYS * 86400,))
        await self.conn.execute("DELETE FROM events WHERE ts < ?", (now - LOG_RETENTION_DAYS * 86400,))
        await self.conn.execute("DELETE FROM metrics WHERE ts < ?", (now - METRIC_RETENTION_DAYS * 86400,))
        await self.conn.commit()

    async def vacuum(self) -> None:
        await self.conn.execute("VACUUM")


db = DB()
