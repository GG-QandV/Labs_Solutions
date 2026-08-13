"""Конфигурация демо `agents`. Всё через env, дефолты — рабочие для локального запуска."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("DATA_DIR", ROOT / "data"))
CACHE_DIR = DATA_DIR / "cache"
DOCS_DIR = DATA_DIR / "docs"

LANGS = ("en", "uk", "pl", "ru")
DEFAULT_LANG = "en"
DOC_PAIR = os.environ.get("DOC_PAIR", "services-agreement")

# Живой прогон: без ключа доступен только кэш — демо остаётся рабочим всегда.
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
LIVE_ENABLED = bool(GEMINI_API_KEY)

# Лимит живых прогонов: демо публичное, LLM платный.
LIVE_RUNS_PER_DAY_PER_IP = int(os.environ.get("LIVE_RUNS_PER_DAY_PER_IP", "3"))

# Темп воспроизведения. Сервер задаёт паузы сам, чтобы шаги читались одинаково у всех.
SPEED = float(os.environ.get("SPEED", "1.0"))

# Ожидание подтверждения человеком (шаг 06 трека сайта). Дальше — таймаут, поток закрывается.
GATE_TIMEOUT_SEC = int(os.environ.get("GATE_TIMEOUT_SEC", "300"))
# Пинг в SSE, пока ждём подтверждения: у Cloudflare простой ~100 с рвёт соединение (524).
GATE_PING_SEC = int(os.environ.get("GATE_PING_SEC", "15"))

PORT = int(os.environ.get("PORT", "8080"))


def cache_path(lang: str, pair: str = DOC_PAIR) -> Path:
    return CACHE_DIR / f"{pair}.{lang}.json"
