# RAG Demo — ask your documents (VPS, Traefik + OpsHub)

One container: UI + API + indexing worker + ONNX models + SQLite/sqlite-vec.
Answers come only from retrieved fragments; every claim is cited.

## Stack
- Python 3.12 · FastAPI · uv (no venv rituals)
- ONNX (adapted from Mnemostroma `models/`): multilingual-e5-small 384d (embeddings),
  ms-marco-TinyBERT-L2-v2 (reranker, lazy), distilbert-multilingual NER (citation highlighting)
- SQLite + sqlite-vec — no Qdrant, no Postgres, no extra containers
- Gemini free tier for answers and for OCR of scanned pages (zerox approach: page -> PNG -> vision)
- Resend for the registration confirmation email (shared fleet quota)

## Limits (all env-tunable)
5 files / 10 pages / 10 MB per session · 20 questions per hour · 1 hour session TTL ·
chunks <=420 tokens with 70 overlap (hard-bounded by e5-small max_length 512) ·
top_k 10 -> rerank -> 5 citations.

## Fleet integration (OpsHub)
`demo=true` label, `mem_limit: 2048m` + `restart: on-failure` (native cgroup OOM protection),
`GET /health`, heartbeat + ERROR/CRITICAL logs through `clients/opshub_client.py`.
Start/stop/restart, autostop after 30 idle minutes and the nightly restart are driven by OpsHub —
the service is cold-start friendly: models load lazily on first use.

## Run
```bash
cp .env.example .env      # GEMINI_API_KEY, RESEND_API_KEY, OPSHUB_KEY
docker compose up -d --build
```
Weights (~300 MB) are downloaded during the image build and never committed to git.
Without weights the service still starts and reports `models.embedder=false` in /health
(deterministic mock embeddings — dev only, never a silent production fallback).

## Data lifecycle
Daily wipe at 03:00 (files, chunks, vectors, anonymous sessions); a 15-minute warning banner
with a one-time "Postpone 1 hour". Registered users' data is kept 7 days.
DeepSeek can replace Gemini for answers (`LLM_PROVIDER=deepseek`) but has no vision — OCR is then disabled.
