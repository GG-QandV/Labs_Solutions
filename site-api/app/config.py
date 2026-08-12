"""Configuration — env-tunable, same conventions as OpsHub."""
from __future__ import annotations

import os

DB_PATH = os.environ.get("SITE_DB", "/data/site.db")
PORT = int(os.environ.get("PORT", "8000"))

# Resend (transactional email)
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
MAIL_FROM = os.environ.get("MAIL_FROM", "Labs <hello@labs.mnemostroma.com>")

# OpsHub integration (server-to-server, opsnet network)
OPSHUB_URL = os.environ.get("OPSHUB_URL", "http://opshub:8700")
OPSHUB_KEY = os.environ.get("OPSHUB_KEY", "")

# Security
IP_HASH_SALT = os.environ.get("IP_HASH_SALT", "")  # HMAC salt; empty -> hashing disabled (dev only)
CAPTCHA_ENABLED = os.environ.get("CAPTCHA_ENABLED", "false").lower() in ("1", "true", "yes")
TURNSTILE_SECRET = os.environ.get("TURNSTILE_SECRET", "")

# Rate limits (per contract)
CONSULT_LIMIT_IP = 3          # POST /consult per hour per IP
CONSULT_LIMIT_EMAIL = 1       # per 30 min globally per email
STATUS_LIMIT_IP = 20          # GET /consult/{ref} per 10 min per IP
DEMOS_LIMIT_IP = 60           # GET /demos per min per IP
WAKE_LIMIT_IP = 5             # POST /demos/{slug}/wake per 5 min per IP

MAX_BODY_BYTES = 32 * 1024     # 32 KB request body cap

# Slots
SLOT_MINUTES = 30
SLOTS_HORIZON_DAYS = 30
