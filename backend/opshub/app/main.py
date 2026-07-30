"""OpsHub v1 — fleet control plane: logs + health + metrics + dashboard + launcher."""
from __future__ import annotations

import asyncio
import base64
import logging
import os
import secrets
import time
from contextlib import asynccontextmanager
from typing import Any

import bcrypt
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .db import db
from . import dockerio

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("opshub")

OPSHUB_KEY = os.environ.get("OPSHUB_KEY", "")
ADMIN_LOGIN = os.environ.get("ADMIN_LOGIN", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")  # set once; hashed into DB on boot
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
MAX_LOGS_PER_MIN = int(os.environ.get("MAX_LOGS_PER_MIN", "100"))

scheduler = AsyncIOScheduler()
_log_rate: dict[str, tuple[int, int]] = {}  # service -> (minute_window, count)


# ---------- auth ----------
def require_key(x_opshub_key: str = Header(default="")) -> None:
    if not OPSHUB_KEY or not secrets.compare_digest(x_opshub_key, OPSHUB_KEY):
        raise HTTPException(401, "invalid api key")


async def require_basic(request: Request) -> str:
    hdr = request.headers.get("authorization", "")
    if hdr.startswith("Basic "):
        try:
            login, pwd = base64.b64decode(hdr[6:]).decode().split(":", 1)
            user = await db.get_user(login)
            if user and bcrypt.checkpw(pwd.encode(), user["password_hash"].encode()):
                return login
        except Exception:  # noqa: BLE001
            pass
    raise HTTPException(401, "auth required", headers={"WWW-Authenticate": 'Basic realm="opshub"'})


# ---------- models ----------
class LogEntry(BaseModel):
    service: str = Field(min_length=1, max_length=64)
    level: str
    event: str = "error"
    message: str
    traceback: str | None = None
    request_id: str | None = None
    meta: dict[str, Any] | None = None


class RegisterBody(BaseModel):
    service: str = Field(min_length=1, max_length=64)
    container_name: str
    url_health: str | None = None


class HeartbeatBody(BaseModel):
    service: str


# ---------- app ----------
@asynccontextmanager
async def lifespan(_app: FastAPI):
    await db.open()
    if ADMIN_PASSWORD:
        await db.upsert_user(ADMIN_LOGIN, bcrypt.hashpw(ADMIN_PASSWORD.encode(), bcrypt.gensalt()).decode())
    tasks = [
        asyncio.create_task(dockerio.stats_loop()),
        asyncio.create_task(dockerio.health_loop()),
        asyncio.create_task(dockerio.autostop_loop()),
        asyncio.create_task(dockerio.events_loop()),
    ]
    scheduler.add_job(db.rotate, CronTrigger(hour=5, minute=0))
    scheduler.add_job(db.vacuum, CronTrigger(day_of_week="sun", hour=5, minute=30))
    scheduler.start()
    await _schedule_service_restarts()
    yield
    scheduler.shutdown(wait=False)
    for t in tasks:
        t.cancel()
    await db.close()


async def _schedule_service_restarts() -> None:
    """Per-service restart_cron -> APScheduler jobs (default nightly 04:00)."""
    for svc in await db.list_services():
        _add_restart_job(svc["name"], svc.get("restart_cron") or "0 4 * * *")


def _add_restart_job(name: str, cron: str) -> None:
    try:
        m, h, dom, mon, dow = cron.split()
        scheduler.add_job(
            dockerio.scheduled_restart, CronTrigger(minute=m, hour=h, day=dom, month=mon, day_of_week=dow),
            args=[name], id=f"restart:{name}", replace_existing=True,
        )
    except Exception as e:  # noqa: BLE001
        log.warning("bad restart_cron for %s: %s", name, e)


app = FastAPI(title="OpsHub", lifespan=lifespan, docs_url=None, redoc_url=None)


# ---------- fleet-facing API (X-OpsHub-Key) ----------
@app.post("/api/register", dependencies=[Depends(require_key)])
async def register(body: RegisterBody):
    await db.register_service(body.service, body.container_name, body.url_health)
    _add_restart_job(body.service, "0 4 * * *")
    return {"ok": True}


@app.post("/api/log", dependencies=[Depends(require_key)])
async def add_logs(entries: list[LogEntry]):
    if not entries:
        return {"ok": True, "accepted": 0}
    svc = entries[0].service
    minute = int(time.time() // 60)
    win, cnt = _log_rate.get(svc, (minute, 0))
    if win != minute:
        win, cnt = minute, 0
    if cnt + len(entries) > MAX_LOGS_PER_MIN:
        raise HTTPException(429, "log rate limit (storm protection)")
    _log_rate[svc] = (win, cnt + len(entries))

    bad = [e for e in entries if e.level not in ("error", "critical")]
    if bad:
        raise HTTPException(422, "only error/critical levels are accepted")
    n = await db.add_logs([e.model_dump() for e in entries])
    return {"ok": True, "accepted": n}


@app.post("/api/heartbeat", dependencies=[Depends(require_key)])
async def heartbeat(body: HeartbeatBody):
    await db.heartbeat(body.service)
    return {"ok": True}


# ---------- dashboard API (basic auth) ----------
@app.get("/api/overview", dependencies=[Depends(require_basic)])
async def overview():
    services = await db.list_services()
    running = set(dockerio.running_demo_names())
    out = []
    for svc in services:
        name = svc["name"]
        state = "running" if svc["container_name"] in running else dockerio.container_state(svc["container_name"])
        spark = await db.metrics_sparkline(name, 24)
        last = spark[-1] if spark else {}
        recent_err = await db.query_logs(name, None, int(time.time()) - 3600, 1)
        out.append({
            "name": name,
            "container": svc["container_name"],
            "state": state,
            "mem_mb": last.get("mem_mb"),
            "cpu_pct": last.get("cpu_pct"),
            "spark": [p["mem_mb"] for p in spark][-48:],
            "heartbeat": await db.last_heartbeat(name),
            "recent_error": bool(recent_err),
        })
    return {
        "services": out,
        "running": len(running),
        "max_running": dockerio.MAX_RUNNING,
        "docker": dockerio.DOCKER_OK,
        "ts": int(time.time()),
    }


@app.get("/api/logs", dependencies=[Depends(require_basic)])
async def get_logs(
    service: str | None = None,
    level: str | None = None,
    since: int | None = None,
    limit: int = Query(default=50, le=500),
):
    return await db.query_logs(service, level, since, limit)


@app.post("/api/services/{name}/{action}", dependencies=[Depends(require_basic)])
async def service_action(name: str, action: str):
    svc = await db.get_service(name)
    if not svc:
        raise HTTPException(404, "unknown service")
    try:
        if action == "start":
            dockerio.start_service(svc["container_name"])
        elif action == "stop":
            dockerio.stop_service(svc["container_name"])
        elif action == "restart":
            dockerio.restart_service(svc["container_name"])
        else:
            raise HTTPException(400, "action must be start|stop|restart")
    except dockerio.LaunchError as e:
        raise HTTPException(409, str(e)) from e
    await db.add_event(name, action, {"by": "dashboard"})
    return {"ok": True}


# ---------- health & static ----------
@app.get("/health")
async def health():
    return {"ok": True, "docker": dockerio.DOCKER_OK}


@app.get("/", dependencies=[Depends(require_basic)])
async def index():
    return FileResponse(os.path.join(STATIC_DIR, "dashboard.html"))


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
