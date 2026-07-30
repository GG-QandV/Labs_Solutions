"""Docker integration: events subscription, stats collection, health poll, launcher.
Degrades gracefully when /var/run/docker.sock is unavailable (dev mode)."""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any

import httpx

from .db import db

log = logging.getLogger("opshub.docker")

DEMO_LABEL = os.environ.get("DEMO_LABEL", "demo")
MAX_RUNNING = int(os.environ.get("MAX_RUNNING_DEMOS", "3"))
DATA_ROOT = os.environ.get("DEMOS_DATA_ROOT", "/srv/demos")

try:
    import docker  # type: ignore

    _client = docker.from_env()
    _client.ping()
    DOCKER_OK = True
except Exception as e:  # noqa: BLE001
    _client = None
    DOCKER_OK = False
    log.warning("docker unavailable, collector/launcher disabled: %s", e)


def _demo_containers(all_: bool = True) -> list[Any]:
    if not DOCKER_OK:
        return []
    return _client.containers.list(all=all_, filters={"label": f"{DEMO_LABEL}=true"})


def running_demo_names() -> list[str]:
    return [c.name for c in _demo_containers(all_=False)]


def container_state(name: str) -> str:
    if not DOCKER_OK:
        return "unknown"
    try:
        return _client.containers.get(name).status  # running|exited|...
    except Exception:  # noqa: BLE001
        return "absent"


# ---------- launcher ----------
class LaunchError(Exception):
    pass


def start_service(container_name: str) -> None:
    if not DOCKER_OK:
        raise LaunchError("docker unavailable")
    running = running_demo_names()
    if container_name in running:
        return
    if len(running) >= MAX_RUNNING:
        raise LaunchError(
            f"Running limit {MAX_RUNNING}/{MAX_RUNNING} reached. Stop one of: {', '.join(running)}"
        )
    _client.containers.get(container_name).start()


def stop_service(container_name: str) -> None:
    if not DOCKER_OK:
        raise LaunchError("docker unavailable")
    _client.containers.get(container_name).stop(timeout=20)


def restart_service(container_name: str) -> None:
    if not DOCKER_OK:
        raise LaunchError("docker unavailable")
    _client.containers.get(container_name).restart(timeout=20)


# ---------- background loops ----------
async def events_loop() -> None:
    """Subscribe to docker events; record start/stop/die/oom for demo containers."""
    if not DOCKER_OK:
        return
    loop = asyncio.get_running_loop()

    def _consume() -> None:
        for ev in _client.events(decode=True, filters={"label": f"{DEMO_LABEL}=true", "type": "container"}):
            action = ev.get("Action", "")
            name = ev.get("Actor", {}).get("Attributes", {}).get("name", "?")
            if action in ("start", "stop", "die", "oom", "restart"):
                asyncio.run_coroutine_threadsafe(_record_event(name, action, ev), loop)

    async def _record_event(name: str, action: str, ev: dict[str, Any]) -> None:
        await db.add_event(name, action, {"exitCode": ev.get("Actor", {}).get("Attributes", {}).get("exitCode")})
        if action in ("die", "oom"):
            await db.add_logs([{
                "service": name, "level": "critical",
                "event": "oom" if action == "oom" else "crash",
                "message": f"container {action} (exitCode={ev.get('Actor', {}).get('Attributes', {}).get('exitCode')})",
            }])

    await asyncio.to_thread(_consume)


async def stats_loop() -> None:
    """Every 60s: mem/cpu per running demo container + /data size."""
    while True:
        try:
            for c in _demo_containers(all_=False):
                s = await asyncio.to_thread(c.stats, stream=False)
                mem_mb = s.get("memory_stats", {}).get("usage", 0) / 1048576
                cpu_pct = _cpu_pct(s)
                disk_mb = _dir_size_mb(os.path.join(DATA_ROOT, c.name, "data"))
                await db.add_metric(c.name, round(mem_mb, 1), round(cpu_pct, 1), disk_mb)
        except Exception as e:  # noqa: BLE001
            log.warning("stats_loop: %s", e)
        await asyncio.sleep(60)


def _cpu_pct(s: dict[str, Any]) -> float:
    try:
        cpu = s["cpu_stats"]["cpu_usage"]["total_usage"] - s["precpu_stats"]["cpu_usage"]["total_usage"]
        sys_ = s["cpu_stats"]["system_cpu_usage"] - s["precpu_stats"]["system_cpu_usage"]
        n = s["cpu_stats"].get("online_cpus", 1)
        return (cpu / sys_) * n * 100 if sys_ > 0 else 0.0
    except Exception:  # noqa: BLE001
        return 0.0


def _dir_size_mb(path: str) -> float:
    total = 0
    if os.path.isdir(path):
        for root, _dirs, files in os.walk(path):
            for f in files:
                try:
                    total += os.path.getsize(os.path.join(root, f))
                except OSError:
                    pass
    return round(total / 1048576, 1)


_health_fail_counts: dict[str, int] = {}


async def health_loop() -> None:
    """Every 60s: GET url_health for running services; 3 consecutive fails -> health_fail."""
    async with httpx.AsyncClient(timeout=5) as client:
        while True:
            try:
                running = set(running_demo_names())
                for svc in await db.list_services():
                    name, url = svc["name"], svc.get("url_health")
                    if not url or svc["container_name"] not in running:
                        _health_fail_counts.pop(name, None)
                        continue
                    full = url if url.startswith("http") else f"http://{svc['container_name']}:8080{url}"
                    ok = False
                    try:
                        r = await client.get(full)
                        ok = r.status_code < 500
                    except Exception:  # noqa: BLE001
                        ok = False
                    if ok:
                        _health_fail_counts.pop(name, None)
                    else:
                        n = _health_fail_counts.get(name, 0) + 1
                        _health_fail_counts[name] = n
                        if n == 3:
                            await db.add_event(name, "health_fail", {"url": full})
                            await db.add_logs([{
                                "service": name, "level": "error", "event": "health_fail",
                                "message": f"health check failed 3x: {full}",
                            }])
            except Exception as e:  # noqa: BLE001
                log.warning("health_loop: %s", e)
            await asyncio.sleep(60)


async def autostop_loop() -> None:
    """Stop demos with no heartbeat for autostop_minutes."""
    while True:
        try:
            running = set(running_demo_names())
            now = int(time.time())
            for svc in await db.list_services():
                if svc["container_name"] not in running:
                    continue
                hb = await db.last_heartbeat(svc["name"])
                limit = (svc.get("autostop_minutes") or 30) * 60
                started_recently = False  # grace: don't stop within first `limit` after start w/o hb
                if hb is None:
                    hb = svc.get("created_at", now)
                    started_recently = now - hb < limit
                if not started_recently and now - hb > limit:
                    try:
                        stop_service(svc["container_name"])
                        await db.add_event(svc["name"], "autostop", {"idle_seconds": now - hb})
                    except Exception as e:  # noqa: BLE001
                        log.warning("autostop %s: %s", svc["name"], e)
        except Exception as e:  # noqa: BLE001
            log.warning("autostop_loop: %s", e)
        await asyncio.sleep(120)


async def scheduled_restart(name: str, attempt: int = 0) -> None:
    """Nightly restart (leak hygiene) — respects live sessions: recent heartbeat -> +1h, max 3 defers.
    Primary leak protection stays native: container mem_limit + cgroup OOM + restart: on-failure."""
    svc = await db.get_service(name)
    if not svc or svc["container_name"] not in set(running_demo_names()):
        return
    hb = await db.last_heartbeat(name)
    if hb and time.time() - hb < 600 and attempt < 3:
        await db.add_event(name, "restart_scheduled", {"deferred": attempt + 1})
        asyncio.get_running_loop().call_later(
            3600, lambda: asyncio.create_task(scheduled_restart(name, attempt + 1))
        )
        return
    try:
        restart_service(svc["container_name"])
        await db.add_event(name, "restart_scheduled", {"attempt": attempt})
    except Exception as e:  # noqa: BLE001
        log.warning("scheduled restart %s: %s", name, e)
