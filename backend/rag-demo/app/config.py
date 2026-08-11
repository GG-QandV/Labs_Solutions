"""Configuration — every limit is env-tunable (fleet convention: no magic numbers in code)."""
from __future__ import annotations

import os

# storage
DB_PATH = os.environ.get("RAG_DB", "/data/rag.db")
FILES_DIR = os.environ.get("RAG_FILES", "/data/files")
MODELS_DIR = os.environ.get("MODELS_DIR", "/models")

# demo limits
MAX_FILES_PER_SESSION = int(os.environ.get("MAX_FILES_PER_SESSION", "5"))
MAX_PAGES_PER_SESSION = int(os.environ.get("MAX_PAGES_PER_SESSION", "10"))
MAX_FILE_MB = float(os.environ.get("MAX_FILE_MB", "10"))
QUESTIONS_PER_HOUR = int(os.environ.get("QUESTIONS_PER_HOUR", "20"))
SESSION_TTL_SECONDS = int(os.environ.get("SESSION_TTL_SECONDS", "3600"))
REGISTERED_RETENTION_DAYS = int(os.environ.get("REGISTERED_RETENTION_DAYS", "7"))

# chunking — hard-bounded by multilingual-e5-small max_length=512 (incl. "passage: " prefix)
CHUNK_TOKENS = int(os.environ.get("CHUNK_TOKENS", "420"))
CHUNK_OVERLAP = int(os.environ.get("CHUNK_OVERLAP", "70"))
EMBED_DIM = 384

# retrieval
TOP_K = int(os.environ.get("TOP_K", "10"))
TOP_N_CITED = int(os.environ.get("TOP_N_CITED", "5"))
RERANK_THRESHOLD = float(os.environ.get("RERANK_THRESHOLD", "-4.0"))  # cross-encoder logit
COSINE_THRESHOLD = float(os.environ.get("COSINE_THRESHOLD", "0.78"))  # used when reranker is unavailable

# external APIs
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_OCR_MODEL = os.environ.get("GEMINI_OCR_MODEL", "gemini-2.5-flash")
ZEN_API_KEY = os.environ.get("OPENCODE_ZEN_API_KEY", "")
ZEN_MODEL = os.environ.get("ZEN_MODEL", "mimo-v2.5-free")
ZEN_BASE_URL = os.environ.get("ZEN_BASE_URL", "https://opencode.ai/zen/v1/chat/completions")
LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "gemini")  # gemini | zen (zen: no vision -> no OCR)
LLM_CALLS_PER_DAY = int(os.environ.get("LLM_CALLS_PER_DAY", "200"))

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
MAIL_FROM = os.environ.get("MAIL_FROM", "RAG Demo <rag@solutions.dpdns.org>")
MAILS_PER_DAY = int(os.environ.get("MAILS_PER_DAY", "30"))  # shared Resend quota with other demos

PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "https://rag.solutions.dpdns.org")
CLEANUP_HOUR = int(os.environ.get("CLEANUP_HOUR", "3"))
CLEANUP_WARN_MINUTES = int(os.environ.get("CLEANUP_WARN_MINUTES", "15"))
PUBLIC_TENANT = "demo-public"
