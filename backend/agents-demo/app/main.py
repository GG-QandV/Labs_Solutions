"""Демо `agents` — сверка двух версий документа двумя независимыми агентами.

Один SSE-поток на всё демо: каждое событие несёт `panel` (a / b / arbiter /
gate / verdict / meta), фронт раскладывает по колонкам. Три соединения не нужны
и упёрлись бы в лимит браузера (SKELETON §2).
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import sys
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import config
from .scenario import run

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "clients"))
try:
    from opshub_client import heartbeat_middleware, opshub_error, opshub_register
except Exception:  # noqa: BLE001 — без OpsHub демо обязано работать
    async def opshub_register() -> None: ...
    def opshub_error(*a, **kw) -> None: ...
    async def heartbeat_middleware(request, call_next): return await call_next(request)

app = FastAPI(title="agents-demo", docs_url=None, redoc_url=None)
app.middleware("http")(heartbeat_middleware)

# run_id → gate. Живёт только в памяти: демо без состояния между рестартами.
_gates: dict[str, asyncio.Event] = {}
_live_hits: dict[str, list[float]] = {}


@app.on_event("startup")
async def _startup() -> None:
    with contextlib.suppress(Exception):
        await opshub_register()


@app.get("/health")
async def health() -> dict:
    """Для Traefik/OpsHub — ходят внутрь контейнера, мимо Cloudflare."""
    return {"ok": True, "live_enabled": config.LIVE_ENABLED}


@app.get("/api/health")
async def api_health() -> dict:
    """Тот же ответ для браузера. Живёт под /api/, чтобы одно правило Cloudflare
    (`URI Path starts with /api/`) закрывало и поток, и health — без `or`,
    который в билдере правил разъезжается по всей зоне."""
    return await health()


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "?")


def _live_allowed(ip: str) -> bool:
    """Живой прогон стоит денег — лимит на IP в сутки."""
    now = time.time()
    hits = [t for t in _live_hits.get(ip, []) if now - t < 86400]
    if len(hits) >= config.LIVE_RUNS_PER_DAY_PER_IP:
        _live_hits[ip] = hits
        return False
    hits.append(now)
    _live_hits[ip] = hits
    return True


@app.get("/api/stream")
async def stream(request: Request, lang: str = config.DEFAULT_LANG, mode: str = "cached"):
    if lang not in config.LANGS:
        lang = config.DEFAULT_LANG

    live = mode == "live"
    if live:
        if not config.LIVE_ENABLED:
            raise HTTPException(409, "live run is not configured")
        if not _live_allowed(_client_ip(request)):
            raise HTTPException(429, "daily live-run limit reached")

    run_id = uuid.uuid4().hex[:12]
    gate = asyncio.Event()
    _gates[run_id] = gate

    async def gen():
        yield f"data: {json.dumps({'panel': 'meta', 'type': 'run', 'run_id': run_id})}\n\n"
        try:
            async for ev in run(lang, live, gate):
                if await request.is_disconnected():
                    break
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
        except Exception as e:  # noqa: BLE001
            opshub_error("scenario_failed", e, {"run_id": run_id, "lang": lang, "live": live})
            yield f"data: {json.dumps({'panel': 'meta', 'type': 'error'})}\n\n"
        finally:
            _gates.pop(run_id, None)
            yield "data: {\"panel\":\"meta\",\"type\":\"end\"}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache, no-store",
        # Обязателен для nginx/прокси: иначе поток буферизуется и пошаговость исчезает.
        "X-Accel-Buffering": "no",
        "Connection": "keep-alive",
    })


@app.post("/api/approve/{run_id}")
async def approve(run_id: str) -> dict:
    """Шаг 06: человек подтверждает отчёт. Без этого verdict не отправляется."""
    gate = _gates.get(run_id)
    if gate is None:
        raise HTTPException(404, "unknown or finished run")
    gate.set()
    return {"ok": True}


app.mount("/", StaticFiles(directory=Path(__file__).parent / "static", html=True), name="static")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(Path(__file__).parent / "static" / "index.html")
