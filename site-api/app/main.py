"""Labs site backend — /api/v1/*. Consultation booking + slots + demo states.
Contract: landing/docs/BACKEND_API.md (single prefix /api/v1)."""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import secrets
import time
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from . import config
from .admin import register as register_admin
from .db import db

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("site")

app = FastAPI(title="Labs Site API", docs_url=None, redoc_url=None)
register_admin(app)


@app.middleware("http")
async def no_store(request, call_next):
    """API responses must never be cached — neither by Cloudflare nor by the
    browser. A stale /api/v1/demos cached with max-age=14400 (old Cache
    Everything rule) kept showing 'down' for hours in normal tabs."""
    from starlette.responses import Response
    resp: Response = await call_next(request)
    resp.headers["Cache-Control"] = "no-store"
    return resp

# allowed demo slugs -> container name (whitelist, never from request)
DEMO_MAP = {
    "dispatcher": "dispatcher-api",
    "ocr": "ocr",
    "rag": "rag-demo",
    "report": "pdf-demo",
    "crm": "crm",
    "analyst": "analyst",
    "agents": "agents-demo",
    "agentmesh": "agentmesh-site",
}
# статические продукты (не OpsHub-демо): всегда готовы, не «soon»/«down»
ALWAYS_READY = {"agentmesh"}
SERVICE_CHOICES = ("rag", "pdf", "dispatcher", "extraction", "crm", "analyst", "other")


# ---------- helpers ----------
def make_ref() -> str:
    year = time.strftime("%Y")
    return f"LM-{year}-{secrets.token_hex(3).upper()}"


def _hmac(value: str) -> str | None:
    if not config.IP_HASH_SALT:
        return None
    return hmac.new(config.IP_HASH_SALT.encode(), value.encode(), hashlib.sha256).hexdigest()


def client_ip(request: Request) -> str:
    return (request.headers.get("x-forwarded-for", "") or request.client.host).split(",")[0].strip()


async def check_captcha(token: str | None) -> bool:
    if not config.CAPTCHA_ENABLED:
        return True
    if not token or not config.TURNSTILE_SECRET:
        return False
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.post(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            data={"secret": config.TURNSTILE_SECRET, "response": token},
        )
        return r.json().get("success", False)


async def send_email(to: str, subject: str, text: str) -> None:
    if not config.RESEND_API_KEY:
        log.warning("RESEND_API_KEY unset — email skipped for %s", to)
        return
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(
            "https://api.resend.com/emails",
            headers={"authorization": f"Bearer {config.RESEND_API_KEY}"},
            json={"from": config.MAIL_FROM, "to": [to], "subject": subject, "text": text},
        )
        r.raise_for_status()


# ---------- request models ----------
class ConsultBody(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    contact_telegram: str | None = Field(default=None, max_length=80)
    company: str | None = Field(default=None, max_length=120)
    service: str | None = Field(default=None, max_length=30)
    process: str = Field(min_length=20, max_length=1200)
    slot_id: int | None = None
    website: str = Field(default="", max_length=200)  # honeypot
    locale: str = Field(default="en", pattern="^(en|uk|ru|pl)$")
    page: str | None = Field(default=None, max_length=200)
    captcha_token: str | None = None


# ---------- consult ----------
@app.post("/api/v1/consult", status_code=202)
async def create_consult(body: ConsultBody, request: Request):
    # honeypot: silent fake success, nothing stored
    if body.website:
        return {"ref": make_ref(), "status": "received"}

    ip = client_ip(request)
    ip_hash = _hmac(ip)
    ua_hash = _hmac((request.headers.get("user-agent") or "")[:300])

    # rate limits
    ok, resets = db.bump(f"consult:ip:{ip_hash or ip}", config.CONSULT_LIMIT_IP, 3600)
    if not ok:
        raise HTTPException(429, f"Too many requests. Retry in {resets // 60} min.", headers={"X-RateLimit-Reset": str(resets)})
    if db.has_email_recently(str(body.email).lower(), 1800):
        raise HTTPException(429, "This email was used recently. Try again in 30 minutes.")

    # captcha
    if not await check_captcha(body.captcha_token):
        raise HTTPException(403, "CAPTCHA verification failed.", detail="captcha_failed")

    # service choice validation
    if body.service and body.service not in SERVICE_CHOICES:
        raise HTTPException(400, f"Unknown service: {body.service}")

    # slot booking (optional) — atomic, must exist & be open & future
    slot_starts_at = None
    if body.slot_id is not None:
        slot = db.get_slot(body.slot_id)
        if not slot or slot["starts_at"] < int(time.time()):
            raise HTTPException(400, "This slot is no longer available.", detail="slot_unavailable")
        if not db.book_slot(slot["id"]):
            raise HTTPException(409, "This slot was just taken. Pick another.", detail="slot_taken")
        slot_starts_at = slot["starts_at"]

    ref = make_ref()
    db.create_request({
        "ref": ref,
        "name": body.name.strip(),
        "email": str(body.email).lower(),
        "contact_telegram": (body.contact_telegram or "").strip() or None,
        "company": (body.company or "").strip() or None,
        "service": body.service,
        "process": body.process.strip(),
        "slot_id": body.slot_id,
        "slot_starts_at": slot_starts_at,
        "ip_hash": ip_hash,
        "ua_hash": ua_hash,
        "locale": body.locale,
        "page": body.page,
    })

    # emails — best effort; even if they fail the booking stands (503 in contract)
    try:
        slot_txt = ""
        if slot_starts_at:
            slot_txt = f"\nSlot: {time.strftime('%Y-%m-%d %H:%M', time.localtime(slot_starts_at))} (Europe/Kyiv)"
        await send_email(
            str(body.email),
            "Your Labs consultation request",
            f"Hi {body.name},\n\nYour request is received.\nReference: {ref}\n"
            f"Service: {body.service or 'n/a'}\n{slot_txt}\n\nWe will prepare and get back to you shortly.\n",
        )
        owner_email = os.environ.get("OWNER_EMAIL", "")
        if owner_email:
            await send_email(
                owner_email,
                f"New Labs booking: {body.name} ({body.service or '?'})",
                f"Name: {body.name}\nEmail: {body.email}\nTG: {body.contact_telegram or '-'}\n"
                f"Company: {body.company or '-'}\nService: {body.service or '-'}\n"
                f"Slot: {slot_txt.strip() or '-'}\n\nProcess:\n{body.process}\n",
            )
    except Exception as e:  # noqa: BLE001
        log.warning("email failed: %s", e)

    return {"ref": ref, "status": "received"}


# ---------- status ----------
@app.get("/api/v1/consult/{ref}")
async def consult_status(ref: str, request: Request):
    ip = client_ip(request)
    ip_hash = _hmac(ip)
    ok, resets = db.bump(f"status:ip:{ip_hash or ip}", config.STATUS_LIMIT_IP, 600)
    if not ok:
        raise HTTPException(429, f"Too many lookups. Retry in {resets // 60} min.")
    row = db.get_request_by_ref(ref)
    if not row:
        raise HTTPException(404, "Not found")
    return {
        "ref": row["ref"],
        "status": row["status"],
        "next_step": row["next_step"],
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(row["created_at"])),
        "slot_starts_at": row["slot_starts_at"],
    }


# ---------- slots ----------
@app.get("/api/v1/slots")
async def list_slots(request: Request):
    """Free slots for the booking form."""
    return [{"id": s["id"], "starts_at": s["starts_at"]} for s in db.list_open_slots(config.SLOTS_HORIZON_DAYS * 86400)]


# ---------- demos ----------
def _opshub_auth() -> dict[str, str]:
    """Basic Auth for OpsHub control endpoints (overview, services)."""
    if config.OPSHUB_ADMIN_LOGIN and config.OPSHUB_ADMIN_PASSWORD:
        return {"authorization": "Basic " + base64.b64encode(
            f"{config.OPSHUB_ADMIN_LOGIN}:{config.OPSHUB_ADMIN_PASSWORD}".encode()).decode()}
    return {"x-opshub-key": config.OPSHUB_KEY}


@app.get("/api/v1/demos")
async def demos():
    # Источник правды — DEMO_MAP: иначе новый слаг ломает ответ KeyError'ом ниже.
    states = {slug: "soon" for slug in DEMO_MAP}
    for slug in ALWAYS_READY:
        states[slug] = "ready"  # статические продукты (напр. agentmesh-лендинг) всегда online
    try:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get(f"{config.OPSHUB_URL}/api/overview", headers=_opshub_auth())
            if r.status_code == 200:
                for s in r.json().get("services", []):
                    for slug, container in DEMO_MAP.items():
                        if container == s.get("container") or container == s["name"]:
                            states[slug] = "ready" if s["state"] == "running" else "down"
    except Exception as e:  # noqa: BLE001
        log.warning("opshub overview failed: %s", e)
    return [
        {"slug": slug, "state": states[slug], "url": f"/demos/{slug}" if states[slug] != "soon" else None}
        for slug, _name in DEMO_MAP.items()
    ]


@app.post("/api/v1/demos/{slug}/wake", status_code=202)
async def wake(slug: str, request: Request):
    if slug not in DEMO_MAP:
        raise HTTPException(404, "Unknown demo")
    ip = client_ip(request)
    ip_hash = _hmac(ip)
    ok, resets = db.bump(f"wake:ip:{ip_hash or ip}", config.WAKE_LIMIT_IP, 300)
    if not ok:
        raise HTTPException(429, f"Too many wake requests. Retry in {resets // 60} min.")
    container = DEMO_MAP[slug]
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(
                f"{config.OPSHUB_URL}/api/services/{container}/start",
                headers=_opshub_auth(),
            )
            if r.status_code == 409:
                raise HTTPException(409, "Another demo is warming up, try in a moment", detail="capacity")
            if r.status_code >= 400:
                raise HTTPException(502, "Demo could not be started")
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        log.warning("wake failed: %s", e)
        raise HTTPException(502, "Demo could not be started") from e
    return {"slug": slug, "state": "warming", "eta_seconds": 15}


# ---------- health ----------
@app.get("/api/v1/health")
async def health():
    return {"ok": True, "service": "site-api"}


@app.get("/health")
async def health_short():
    return {"ok": True}
