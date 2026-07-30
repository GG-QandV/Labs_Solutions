"""LLM provider adapters — the ONE clearly separated integration point for the cloud model.

Everything above this module (translate/summary endpoints) speaks a single contract:
    await complete(system_prompt, user_content, *, api_key=None) -> str
Provider choice and transport details live only here. Supported:
  - openai-compatible (DeepSeek, OpenAI, OpenRouter, local proxies) — LLM_BASE_URL + LLM_MODEL
  - gemini — Google Generative Language API
BYOK: a per-session key (RAM-only, see BYOK spec) overrides the server key per call.
Retries: exponential backoff, max 3 attempts, never infinite (per the base prompt).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from typing import Any

import httpx

log = logging.getLogger("llm.provider")

PROVIDER = os.environ.get("LLM_PROVIDER", "openai")  # openai (=openai-compatible) | gemini
BASE_URL = os.environ.get("LLM_BASE_URL", "https://api.deepseek.com")
MODEL = os.environ.get("LLM_MODEL", "deepseek-chat")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
SERVER_KEY = os.environ.get("TRANSLATE_API_KEY", "")
TIMEOUT = float(os.environ.get("LLM_TIMEOUT_SECONDS", "45"))
MAX_ATTEMPTS = 3

_KEY_RE = re.compile(r"(sk-[A-Za-z0-9_\-]{8,}|AIza[A-Za-z0-9_\-]{10,}|Bearer\s+\S+)")


def redact(text: str) -> str:
    """LogRedactor: masks known API-key patterns before ANY log line is written."""
    return _KEY_RE.sub("[REDACTED_KEY]", text)


class LLMError(RuntimeError):
    def __init__(self, message: str, retryable: bool = False, status: int | None = None) -> None:
        super().__init__(redact(message))
        self.retryable = retryable
        self.status = status


async def complete(system_prompt: str, user_content: str, *, api_key: str | None = None) -> str:
    """Single entry point. api_key=BYOK session key (overrides the server key)."""
    key = api_key or SERVER_KEY
    if not key:
        raise LLMError("No API key configured (set TRANSLATE_API_KEY or use a BYOK session).", retryable=False)

    last: LLMError | None = None
    for attempt in range(MAX_ATTEMPTS):
        try:
            if PROVIDER == "gemini":
                return await _gemini(system_prompt, user_content, key)
            return await _openai_compatible(system_prompt, user_content, key)
        except LLMError as e:
            last = e
            if not e.retryable or attempt == MAX_ATTEMPTS - 1:
                raise
            delay = 2**attempt  # 1s, 2s
            log.warning("LLM attempt %d failed (%s), retrying in %ds", attempt + 1, redact(str(e)), delay)
            await asyncio.sleep(delay)
    raise last or LLMError("LLM failed")


async def _openai_compatible(system_prompt: str, user_content: str, key: str) -> str:
    async with httpx.AsyncClient(timeout=TIMEOUT) as c:
        try:
            r = await c.post(
                f"{BASE_URL.rstrip('/')}/chat/completions",
                headers={"authorization": f"Bearer {key}"},
                json={
                    "model": MODEL,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_content},
                    ],
                    "temperature": 0.2,
                    "response_format": {"type": "json_object"},
                },
            )
        except httpx.HTTPError as e:
            raise LLMError(f"network: {e}", retryable=True) from e
    if r.status_code in (429, 500, 502, 503, 504):
        raise LLMError(f"provider {r.status_code}", retryable=True, status=r.status_code)
    if r.status_code >= 400:
        raise LLMError(f"provider {r.status_code}: {r.text[:200]}", retryable=False, status=r.status_code)
    try:
        return r.json()["choices"][0]["message"]["content"]
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        raise LLMError(f"malformed provider response: {e}", retryable=False) from e


async def _gemini(system_prompt: str, user_content: str, key: str) -> str:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={key}"
    async with httpx.AsyncClient(timeout=TIMEOUT) as c:
        try:
            r = await c.post(
                url,
                json={
                    "system_instruction": {"parts": [{"text": system_prompt}]},
                    "contents": [{"parts": [{"text": user_content}]}],
                    "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json"},
                },
            )
        except httpx.HTTPError as e:
            raise LLMError(f"network: {e}", retryable=True) from e
    if r.status_code in (429, 500, 502, 503):
        raise LLMError(f"gemini {r.status_code}", retryable=True, status=r.status_code)
    if r.status_code >= 400:
        raise LLMError(f"gemini {r.status_code}: {r.text[:200]}", retryable=False, status=r.status_code)
    data = r.json()
    parts = [p.get("text", "") for cand in data.get("candidates", []) for p in cand.get("content", {}).get("parts", [])]
    if not parts:
        raise LLMError("gemini returned no candidates", retryable=False)
    return "".join(parts)


def parse_json_reply(text: str) -> dict[str, Any]:
    """Providers occasionally wrap JSON in fences despite instructions — strip and parse."""
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.S)
    try:
        out = json.loads(cleaned)
    except json.JSONDecodeError as e:
        raise LLMError(f"model did not return valid JSON: {e}", retryable=False) from e
    if not isinstance(out, dict):
        raise LLMError("model JSON root must be an object", retryable=False)
    return out
