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

# chunking — hard-bounded by embedder max_length (Granite: 32k; e5-small: 512)
CHUNK_TOKENS = int(os.environ.get("CHUNK_TOKENS", "420"))
CHUNK_OVERLAP = int(os.environ.get("CHUNK_OVERLAP", "70"))
EMBED_DIM = int(os.environ.get("EMBED_DIM", "384"))  # vec_chunks float[EMBED_DIM] — must match the model

# models (dir names under MODELS_DIR; weights baked into the image at build)
EMBED_MODEL = os.environ.get("EMBED_MODEL", "granite-embedding-r2")
EMBED_DIR = os.path.join(MODELS_DIR, EMBED_MODEL)
# pooling: "first" = first token (<|startoftext|>, ModernBERT has no [CLS]) | "mean"
EMBED_POOLING = os.environ.get("EMBED_POOLING", "first")
# 1 = prepend query:/passage: prefixes (rollback path for e5-small; Granite needs none)
EMBED_PREFIXED = os.environ.get("EMBED_PREFIXED", "0") == "1"
RERANK_MODEL = os.environ.get("RERANK_MODEL", "gte-reranker")
RERANK_DIR = os.path.join(MODELS_DIR, RERANK_MODEL)

# retrieval
TOP_K = int(os.environ.get("TOP_K", "10"))
TOP_N_CITED = int(os.environ.get("TOP_N_CITED", "5"))
RERANK_THRESHOLD = float(os.environ.get("RERANK_THRESHOLD", "-4.0"))  # cross-encoder logit (informational now)
# empty = rerank soft-filter disabled (Task 7); numeric value enables it after G4 logit measurement
RERANK_THRESHOLD_LOOSE = os.environ.get("RERANK_THRESHOLD_LOOSE", "")
COSINE_THRESHOLD = float(os.environ.get("COSINE_THRESHOLD", "0.55"))  # relevance bar (retrieve filter)

# trap logs (audit F8): TRAP_LOGS=0 silences everything; TRAP_LEVEL is the cutoff
TRAP_LOGS = os.environ.get("TRAP_LOGS", "1") == "1"
TRAP_LEVEL = os.environ.get("TRAP_LEVEL", "warning")  # error | warning | info | debug

# external APIs
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_OCR_MODEL = os.environ.get("GEMINI_OCR_MODEL", "gemini-2.5-flash")
ZEN_API_KEY = os.environ.get("OPENCODE_ZEN_API_KEY", "")
LLM_MODEL = os.environ.get("LLM_MODEL", "mimo-v2.5-free")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://opencode.ai/zen/v1")
LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "gemini")  # gemini | zen (zen: no vision -> no OCR)
LLM_CALLS_PER_DAY = int(os.environ.get("LLM_CALLS_PER_DAY", "200"))

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
MAIL_FROM = os.environ.get("MAIL_FROM", "RAG Demo <rag@solutions.dpdns.org>")
MAILS_PER_DAY = int(os.environ.get("MAILS_PER_DAY", "30"))  # shared Resend quota with other demos

PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "https://rag.solutions.dpdns.org")
CLEANUP_HOUR = int(os.environ.get("CLEANUP_HOUR", "3"))
CLEANUP_WARN_MINUTES = int(os.environ.get("CLEANUP_WARN_MINUTES", "15"))
PUBLIC_TENANT = "demo-public"
