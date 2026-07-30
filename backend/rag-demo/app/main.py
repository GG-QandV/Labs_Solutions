"""RAG demo service — single container (UI + API + worker + ONNX models + SQLite).
Fleet conventions: /health, OpsHub heartbeat + error logs, cold-start friendly (lazy models)."""
from __future__ import annotations

import asyncio
import datetime as dt
import logging
import os
import secrets
import time
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr

from . import config
from .db import db
from .models.engine import embedder, models_status
from .rag import answer as ans
from .rag import ingest

import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "clients"))
try:
    from opshub_client import heartbeat_middleware, opshub_error, opshub_register  # type: ignore
except Exception:  # noqa: BLE001 — the demo must run without OpsHub too
    async def opshub_register() -> None: ...
    def opshub_error(*_a: Any, **_k: Any) -> None: ...
    async def heartbeat_middleware(request, call_next):  # type: ignore
        return await call_next(request)

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("rag")
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")

# one indexing job at a time per the demo limits
index_lock = asyncio.Lock()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await opshub_register()
    task = asyncio.create_task(cleanup_loop())
    yield
    task.cancel()


app = FastAPI(title="RAG Demo", lifespan=lifespan, docs_url=None, redoc_url=None)
app.middleware("http")(heartbeat_middleware)


# ---------- session ----------
def session_of(request: Request) -> dict[str, Any]:
    s = db.get_session(request.headers.get("x-demo-token"))
    if not s:
        raise HTTPException(401, "Session expired. Start a new demo session.")
    return s


@app.post("/api/session")
async def new_session(request: Request):
    ip = (request.headers.get("x-forwarded-for", "") or request.client.host).split(",")[0].strip()
    ok, resets = db.bump(f"sess:ip:{ip}", 10, 3600)
    if not ok:
        raise HTTPException(429, f"Too many sessions from your address. Retry in {resets // 60} min.")
    token = secrets.token_hex(16)
    return db.create_session(token, tenant_id=f"anon-{token[:12]}")


@app.get("/api/session")
async def check_session(request: Request):
    s = db.get_session(request.headers.get("x-demo-token"))
    if not s:
        raise HTTPException(401, "expired")
    return {"valid": True, "expires_at": s["expires_at"] * 1000, "cleanup_at": next_cleanup_ts() * 1000}


# ---------- documents ----------
@app.get("/api/documents")
async def documents(s: dict = Depends(session_of)):
    usage = db.tenant_usage(s["tenant_id"])
    return {
        "documents": db.list_documents(s["tenant_id"]),
        "usage": usage,
        "limits": {
            "files": config.MAX_FILES_PER_SESSION,
            "pages": config.MAX_PAGES_PER_SESSION,
            "file_mb": config.MAX_FILE_MB,
        },
        "models": models_status(),
    }


@app.post("/api/documents")
async def upload(request: Request, file: UploadFile = File(...), s: dict = Depends(session_of)):
    usage = db.tenant_usage(s["tenant_id"])
    if usage["files"] >= config.MAX_FILES_PER_SESSION:
        raise HTTPException(413, f"Demo limit: {config.MAX_FILES_PER_SESSION} files per session.")

    head = await file.read(8)
    rest = await file.read(int(config.MAX_FILE_MB * 1024 * 1024) + 1)
    data = head + rest
    if len(data) > config.MAX_FILE_MB * 1024 * 1024:
        raise HTTPException(413, f"File is larger than {config.MAX_FILE_MB:.0f} MB.")
    try:
        kind = ingest.sniff_type(file.filename or "", head)
    except ingest.IngestError as e:
        raise HTTPException(415, str(e)) from e

    os.makedirs(os.path.join(config.FILES_DIR, s["tenant_id"]), exist_ok=True)
    path = os.path.join(config.FILES_DIR, s["tenant_id"], f"{secrets.token_hex(6)}-{os.path.basename(file.filename or 'file')}")
    with open(path, "wb") as f:
        f.write(data)

    doc_id = db.add_document(s["tenant_id"], file.filename or "file", path)
    asyncio.create_task(index_document(doc_id, s["tenant_id"], file.filename or "file", path, kind))
    return {"id": doc_id, "status": "pending"}


async def index_document(doc_id: int, tenant_id: str, filename: str, path: str, kind: str) -> None:
    """extracting -> (OCR) -> indexing -> ready. One document at a time (demo CPU budget)."""
    async with index_lock:
        try:
            db.set_document(doc_id, status="extracting")
            pages = await asyncio.to_thread(ingest.extract_pages, path, kind)

            used = db.tenant_usage(tenant_id)["pages"]
            if used + len(pages) > config.MAX_PAGES_PER_SESSION:
                raise ingest.IngestError(
                    f"Demo limit: {config.MAX_PAGES_PER_SESSION} pages per session "
                    f"({used} already indexed, this file has {len(pages)})."
                )

            ocr_targets = ingest.needs_ocr(pages, kind)
            if ocr_targets:
                ok, _ = db.bump("llm:day", config.LLM_CALLS_PER_DAY, 86400)
                if not ok:
                    raise ingest.IngestError("Daily AI quota reached. Try again tomorrow.")
                ocr_text = await ingest.ocr_pages(path, ocr_targets)
                pages = [(n, ocr_text.get(n, t)) for n, t in pages]
                db.set_document(doc_id, ocr_used=1)

            db.set_document(doc_id, status="indexing", pages=len(pages))
            chunks = await asyncio.to_thread(ingest.chunk_pages, pages)
            if not chunks:
                raise ingest.IngestError("No text could be extracted from this file.")
            embeddings = await asyncio.to_thread(embedder.encode_passages, [c[2] for c in chunks])
            db.add_chunks(tenant_id, doc_id, filename, chunks, embeddings)
            db.set_document(doc_id, status="ready")
        except ingest.IngestError as e:
            db.set_document(doc_id, status="error", error=str(e))
        except Exception as e:  # noqa: BLE001
            db.set_document(doc_id, status="error", error="Indexing failed. Try another file.")
            opshub_error("index_failed", e, {"doc_id": doc_id, "filename": filename})
            log.exception("indexing failed")


# ---------- ask ----------
class AskBody(BaseModel):
    question: str


@app.post("/api/ask")
async def ask(body: AskBody, s: dict = Depends(session_of)):
    q = body.question.strip()
    if not q:
        raise HTTPException(400, "Ask a question first.")
    ok, resets = db.bump(f"q:{s['tenant_id']}", config.QUESTIONS_PER_HOUR, 3600)
    if not ok:
        raise HTTPException(429, f"Question limit reached. Resets in {resets // 60} min.")

    try:
        hits = await asyncio.to_thread(ans.retrieve, s["tenant_id"], q)
    except ans.NoContext:
        return {"answer": "Not found in the provided documents.", "sources": [], "grounded": False}

    ok, _ = db.bump("llm:day", config.LLM_CALLS_PER_DAY, 86400)
    if not ok:
        raise HTTPException(429, "Daily AI quota reached. Try again tomorrow.")

    sources = ans.build_sources(hits)
    try:
        text = await ans.ask_llm(ans.build_prompt(q, hits))
    except Exception as e:  # noqa: BLE001
        opshub_error("llm_failed", e, {"tenant": s["tenant_id"]})
        raise HTTPException(502, "The answer service is unavailable right now. Please retry.") from e

    db.save_chat(s["tenant_id"], s.get("user_id"), q, text, sources)
    return {"answer": text, "sources": sources, "grounded": True}


@app.get("/api/history")
async def history(s: dict = Depends(session_of)):
    if not s.get("user_id"):
        return {"items": [], "note": "History is available to registered users."}
    return {"items": db.history(s["user_id"])}


# ---------- registration ----------
class RegisterBody(BaseModel):
    email: EmailStr


@app.post("/api/register")
async def register(body: RegisterBody, s: dict = Depends(session_of)):
    ok, _ = db.bump("mail:day", config.MAILS_PER_DAY, 86400)
    if not ok:
        raise HTTPException(429, "Daily email quota reached. Try again tomorrow.")
    token = secrets.token_urlsafe(24)
    db.create_user(str(body.email), s["tenant_id"], token)
    link = f"{config.PUBLIC_BASE_URL}/api/confirm?token={token}"
    if config.RESEND_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=15) as c:
                r = await c.post(
                    "https://api.resend.com/emails",
                    headers={"authorization": f"Bearer {config.RESEND_API_KEY}"},
                    json={
                        "from": config.MAIL_FROM,
                        "to": [str(body.email)],
                        "subject": "Confirm your RAG demo access",
                        "text": f"Confirm your email to keep your chat history:\n{link}\n\nThe link is valid while your data is retained.",
                    },
                )
                r.raise_for_status()
        except Exception as e:  # noqa: BLE001
            opshub_error("mail_failed", e)
            raise HTTPException(502, "Could not send the confirmation email. Try again later.") from e
    return {"ok": True, "sent_to": str(body.email)}


@app.get("/api/confirm", response_class=HTMLResponse)
async def confirm(token: str):
    user = db.confirm_user(token)
    if not user:
        return HTMLResponse("<p>This confirmation link is no longer valid.</p>", status_code=404)
    return HTMLResponse("<p>Email confirmed. Your chat history will be kept for 7 days.</p>")


# ---------- cleanup ----------
def next_cleanup_ts() -> int:
    now = dt.datetime.now()
    target = now.replace(hour=config.CLEANUP_HOUR, minute=0, second=0, microsecond=0)
    if target <= now:
        target += dt.timedelta(days=1)
    return int(target.timestamp())


@app.get("/api/cleanup")
async def cleanup_info(s: dict = Depends(session_of)):
    ts = next_cleanup_ts()
    warn = ts - time.time() < config.CLEANUP_WARN_MINUTES * 60
    return {
        "cleanup_at": ts * 1000,
        "warning": warn,
        "postponed_until": (s.get("cleanup_postponed_until") or 0) * 1000,
        "can_postpone": (s.get("cleanup_postponed_until") or 0) == 0,
    }


@app.post("/api/cleanup/postpone")
async def postpone(s: dict = Depends(session_of)):
    if s.get("cleanup_postponed_until"):
        raise HTTPException(409, "Cleanup can be postponed once per session.")
    until = int(time.time()) + 3600
    db.postpone_cleanup(s["token"], until)
    return {"postponed_until": until * 1000}


async def cleanup_loop() -> None:
    """Daily wipe at CLEANUP_HOUR; sessions that postponed are skipped until their deadline."""
    while True:
        try:
            now = int(time.time())
            sleep_for = max(60, next_cleanup_ts() - now)
            await asyncio.sleep(min(sleep_for, 900))  # wake at least every 15 min (warning banner)
            if abs(next_cleanup_ts() - int(time.time())) > 86000:  # we are at/after the cleanup point
                for tenant in db.tenants_to_wipe(int(time.time())):
                    stats = db.wipe_tenant(tenant)
                    log.info("wiped %s: %s", tenant, stats)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            opshub_error("cleanup_failed", e)
            await asyncio.sleep(300)


# ---------- health & UI ----------
@app.get("/health")
async def health():
    return {"ok": True, "models": models_status(), "indexing": index_lock.locked()}


@app.get("/")
async def index_page():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
