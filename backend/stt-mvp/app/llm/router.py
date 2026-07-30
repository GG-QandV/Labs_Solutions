"""/api/llm/* — the clearly separated endpoint surface for the cloud model.

Nothing else in the service talks to the LLM: the STT pipeline enqueues translate
jobs that call POST /api/llm/translate internally (or import service functions
directly); the UI uses the same endpoints. Swapping the model = env vars only;
changing its behavior = editing config/llm_prompt.yaml (GET/PUT below).
"""
from __future__ import annotations

import secrets
import time
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from . import provider
from .prompt_builder import PromptConfigError, prompt_config

router = APIRouter(prefix="/api/llm", tags=["llm"])

# ---------------------------------------------------------------------------
# BYOK sessions: key lives ONLY in this dict (RAM), TTL 60 min, manual revoke.
# Never written to SQLite/files/logs (provider.redact guards log lines).
# ---------------------------------------------------------------------------
_BYOK_TTL = 3600
_byok: dict[str, tuple[str, float]] = {}  # session_id -> (api_key, expires_at)


def _byok_key(session_id: str | None) -> str | None:
    if not session_id:
        return None
    item = _byok.get(session_id)
    if not item:
        return None
    key, exp = item
    if exp < time.time():
        _byok.pop(session_id, None)
        return None
    return key


class ByokBody(BaseModel):
    api_key: str = Field(min_length=8)


@router.post("/byok")
async def byok_start(body: ByokBody):
    session_id = secrets.token_urlsafe(24)
    _byok[session_id] = (body.api_key, time.time() + _BYOK_TTL)
    return {"session_id": session_id, "ttl_seconds": _BYOK_TTL}


@router.delete("/byok/{session_id}")
async def byok_revoke(session_id: str):
    _byok.pop(session_id, None)
    return {"revoked": True}


# ---------------------------------------------------------------------------
# Translate + edit (live pipeline)
# ---------------------------------------------------------------------------
class TranslateBody(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    source_lang: str = Field(pattern="^[a-z]{2}(-[A-Z]{2})?$")
    target_lang: str = Field(pattern="^[a-z]{2}(-[A-Z]{2})?$")
    mode: str = Field(default="live_literal", pattern="^(live_literal|post_clean)$")


@router.post("/translate")
async def translate(body: TranslateBody, x_byok_session: str | None = Header(default=None)):
    system_prompt = prompt_config.build_live_prompt(body.source_lang, body.target_lang, body.mode)
    try:
        raw = await provider.complete(system_prompt, body.text, api_key=_byok_key(x_byok_session))
        data = provider.parse_json_reply(raw)
    except provider.LLMError as e:
        raise HTTPException(502 if e.retryable else 422, str(e)) from e

    out: dict[str, Any] = {
        "translation": str(data.get("translation", "")),
        "changes": data.get("changes", []),
        "mode": body.mode,
    }
    if prompt_config.enabled("hints"):
        out["hints"] = [str(h) for h in data.get("hints", [])][: int(
            (prompt_config.raw().get("hints") or {}).get("max_hints", 3)
        )]
    if prompt_config.enabled("action_items"):
        out["action_items"] = data.get("action_items", [])
    if prompt_config.enabled("question_flag"):
        out["is_question"] = bool(data.get("is_question", False))
    if not out["translation"]:
        raise HTTPException(422, "model returned an empty translation")
    return out


# ---------------------------------------------------------------------------
# Summary + key moments (on demand, at/after session end)
# ---------------------------------------------------------------------------
class SummaryBody(BaseModel):
    transcript: str = Field(min_length=1, max_length=200_000)
    target_lang: str = Field(pattern="^[a-z]{2}(-[A-Z]{2})?$")


@router.post("/summary")
async def summary(body: SummaryBody, x_byok_session: str | None = Header(default=None)):
    try:
        system_prompt = prompt_config.build_summary_prompt(body.target_lang)
    except PromptConfigError as e:
        raise HTTPException(409, str(e)) from e  # section disabled in config
    try:
        raw = await provider.complete(system_prompt, body.transcript, api_key=_byok_key(x_byok_session))
        data = provider.parse_json_reply(raw)
    except provider.LLMError as e:
        raise HTTPException(502 if e.retryable else 422, str(e)) from e
    return {
        "summary": str(data.get("summary", "")),
        "key_moments": [str(x) for x in data.get("key_moments", [])],
        "risks": [str(x) for x in data.get("risks", [])],
    }


# ---------------------------------------------------------------------------
# Prompt config: view + edit from UI, hot reload, validation before write
# ---------------------------------------------------------------------------
@router.get("/prompt-config")
async def get_prompt_config():
    return prompt_config.raw()


@router.put("/prompt-config")
async def put_prompt_config(data: dict[str, Any]):
    try:
        prompt_config.save(data)
    except PromptConfigError as e:
        raise HTTPException(422, str(e)) from e
    return {"ok": True, "sections_enabled": {s: prompt_config.enabled(s) for s in
            ("hints", "summary_rules", "glossary", "register", "action_items", "question_flag")}}


@router.get("/prompt-preview")
async def prompt_preview(source_lang: str = "es", target_lang: str = "ru", mode: str = "live_literal"):
    """Debug/UI helper: shows the exact assembled system prompt (never sent to logs)."""
    return {"system_prompt": prompt_config.build_live_prompt(source_lang, target_lang, mode)}


@router.get("/health")
async def health():
    return {
        "ok": True,
        "provider": provider.PROVIDER,
        "model": provider.GEMINI_MODEL if provider.PROVIDER == "gemini" else provider.MODEL,
        "server_key_present": bool(provider.SERVER_KEY),
        "byok_sessions": len(_byok),
        "config_sections": {s: prompt_config.enabled(s) for s in
                            ("hints", "summary_rules", "glossary", "register", "action_items", "question_flag")},
    }
