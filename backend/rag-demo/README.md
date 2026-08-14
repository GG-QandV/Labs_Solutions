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

## Retrieval logic (as of 2026-08-14)
`retrieve()` = vector KNN (cosine) → cross-encoder rerank as a **sort**, not a hard gate →
keep fragments with `cosine >= COSINE_THRESHOLD` (default 0.55) → top-5 citations.

Why not an absolute rerank bar: TinyBERT-L2 logits are systematically ~-9..-11 even for
clearly relevant cross-lingual fragments, so `RERANK_THRESHOLD=-4.0` silently discarded
everything ("Not found in the provided documents" for every question). Rerank now only
re-orders; the cosine threshold decides. `RERANK_THRESHOLD` stays in config as informational.

## Reranker upgrade note — gte-multilingual-reranker-base (evaluated, NOT adopted yet)
Evaluated `Alibaba-NLP/gte-multilingual-reranker-base` as a replacement for TinyBERT-L2.

- Model size: 306M params, encoder-only (first GTE reranker), 8192 token context,
  70+ languages (ru + uk covered) — ideal for ru/uk questions over EN/UA documents.
- ONNX build: `onnx-community/gte-multilingual-reranker-base`
  (files: `onnx/model_int8.onnx`, `onnx/model_quantized.onnx`, `onnx/model_q4.onnx`, `tokenizer.json`)
  → https://huggingface.co/onnx-community/gte-multilingual-reranker-base
- Alternative ONNX: `ConfidentialMind/gte-multilingual-reranker-base-onnx-op14-opt-gpu-int8`
  → https://huggingface.co/ConfidentialMind/gte-multilingual-reranker-base-onnx-op14-opt-gpu-int8
- Size check vs fleet limits (reranker ≤150 MB, runtime ≤1.5–1.7 GB):
  - `onnx-community` int8 ≈ **340 MB** — exceeds the 150 MB reranker budget.
  - `onnx-community` q4 ≈ 835 MB, `ConfidentialMind` int8 ≈ 875 MB — way over.
  - `Xenova/bge-reranker-base` int8 ≈ 278 MB — still over 150 MB.
  - Small multilingual ONNX rerankers (≤150 MB) do not exist on HF; small ones are EN-only (~23 MB).
- **Verdict:** best-quality choice but violates the size budget. Revisit when the
  150 MB reranker cap is raised (runtime impact is acceptable — lazy loading, ~1.5 GB total).
- To adopt: extend `scripts_download_models.py` with the ONNX target, drop files into
  `/models/gte-reranker/`, point `RERANK_DIR` at it, and re-verify logits on real queries.

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
opencode zen (MiMo V2.5 Free) can replace Gemini for answers (`LLM_PROVIDER=zen`, default `LLM_MODEL=mimo-v2.5-free`, `LLM_BASE_URL=https://opencode.ai/zen/v1`) but has no vision — OCR is then disabled.
