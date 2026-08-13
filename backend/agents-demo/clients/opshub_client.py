"""OpsHub drop-in client (Python). Errors + heartbeat; never breaks the host app.
Usage:
    from opshub_client import opshub_register, opshub_error, heartbeat_middleware
    await opshub_register()                       # on startup
    app.middleware("http")(heartbeat_middleware)  # FastAPI: activity heartbeat
    opshub_error("job_failed", exc, {"job": id})  # on ERROR/CRITICAL only
"""
from __future__ import annotations

import json
import os
import time
import traceback as tb
from typing import Any

import httpx

URL = os.environ.get("OPSHUB_URL", "")
KEY = os.environ.get("OPSHUB_KEY", "")
SERVICE = os.environ.get("OPSHUB_SERVICE", "unknown")
BUFFER = "/tmp/opshub-buffer.ndjson"
_last_hb = 0.0


async def _post(path: str, body: Any) -> bool:
    if not URL:
        return True
    try:
        async with httpx.AsyncClient(timeout=3) as c:
            r = await c.post(f"{URL}{path}", json=body, headers={"x-opshub-key": KEY})
            return r.is_success
    except Exception:  # noqa: BLE001
        return False


async def opshub_register() -> None:
    await _post("/api/register", {"service": SERVICE, "container_name": SERVICE, "url_health": "/health"})
    await _flush()


def opshub_error(event: str, err: Any, meta: dict[str, Any] | None = None) -> None:
    entry = {
        "service": SERVICE, "level": "error", "event": event,
        "message": str(err)[:2000],
        "traceback": "".join(tb.format_exception(err))[:8000] if isinstance(err, BaseException) else None,
        "meta": meta,
    }
    import asyncio

    async def send() -> None:
        if not await _post("/api/log", [entry]):
            try:
                with open(BUFFER, "a") as f:
                    f.write(json.dumps(entry) + "\n")
            except OSError:
                pass

    try:
        asyncio.get_running_loop().create_task(send())
    except RuntimeError:
        asyncio.run(send())


async def heartbeat_middleware(request, call_next):  # FastAPI/Starlette middleware
    global _last_hb
    now = time.time()
    if now - _last_hb > 60:
        _last_hb = now
        import asyncio
        asyncio.get_running_loop().create_task(_post("/api/heartbeat", {"service": SERVICE}))
    return await call_next(request)


async def _flush() -> None:
    if not os.path.exists(BUFFER):
        return
    try:
        with open(BUFFER) as f:
            lines = [json.loads(x) for x in f.read().strip().splitlines() if x]
        if lines and await _post("/api/log", lines):
            os.remove(BUFFER)
    except Exception:  # noqa: BLE001
        pass
