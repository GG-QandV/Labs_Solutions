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

## Embedder upgrade note — EmbeddingGemma-300m (evaluated, NOT adopted yet)
Evaluated `onnx-community/embeddinggemma-300m-ONNX` (Google EmbeddingGemma) as a replacement for multilingual-e5-small.

- **What it is**: Google open embedding model, 300M / 768-dim (MRL 512/256/128), 2,048 token context,
  MTEB v2 **61.15** (768d), trained on 320B tokens, **100+ languages** incl. ru/uk. Gemma license.
- **ONNX files**: graph `.onnx` + external weights `.onnx_data` (onnxruntime needs matching basenames in one dir).
  → https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX/tree/main/onnx
- **Size check vs fleet limits** (embedder ≤600–700 MB):
  - `model_quantized.onnx_data` (q8) ≈ **295 MB** ✓ (recommended)
  - `model_q4.onnx_data` ≈ 188 MB ✓, `model_q4f16` ≈ 167 MB ✓, `model_fp16` ≈ 589 MB ✓
  - ⚠️ README: activations do NOT support fp16 — use fp32/q8/q4. **fp16 is a RAM trap here:**
    onnxruntime does not run fp16 on CPU, so a fp16 graph is upcast to fp32 in memory at load time
    (weights ×2 peak + activations), which can spike far beyond the container quota. RAM was NOT
    measured during the eval; as a rule, only use the `quantized` (q8) or `q4` variants whose
    in-memory size ≈ file size. Reference: current pipeline (e5-small 130M + TinyBERT + NER,
    lazy-loaded) idles at ~58 MiB inside the 2 GiB container after warmup.
- **Inputs/outputs (verified)**: `input_ids` + `attention_mask` int64 → `last_hidden_state` [*,*,768] + `sentence_embedding` [*,768].
- **Prefixes (mandatory)**: query → `task: search result | query: …`, document → `title: none | text: …`.
  Without them recall drops sharply.
- **Live test on the resume (3 chunks, ru questions)** — all three ranked the Education/University chunk #1:
  «название высшего учебного заведения» (sim .074), «что за вуз окончил кандидат» (.346), «какие навыки у кандидата» (.311).
  Absolute scores are low (0.07–0.35) vs e5-small (0.65–0.70) — ranking is correct, but `COSINE_THRESHOLD=0.55`
  would discard everything → the threshold must be retuned (~0.05) if adopted.
- **Dimension change** 384 → 768 (or MRL-truncated 128/256/512) requires re-indexing all chunks + `vec_chunks` schema change.
- **Verdict**: strongest recall of the three evaluated embedders (e5-small / Harrier-270m / EmbeddingGemma),
  fits the size budget (q8 295 MB). Needs: prefix wrapping on both sides, threshold retune, dimension migration.
  Revisit when cross-lingual recall becomes the bottleneck.

## Embedder upgrade note — harrier-oss-v1-270m (evaluated, NOT adopted yet)
Evaluated `onnx-community/harrier-oss-v1-270m-ONNX` (Microsoft Harrier) as a replacement for multilingual-e5-small.

- **What it is**: multilingual text-embedding family (MIT), 270M / 640-dim / 32,768 token context,
  MTEB v2 score **66.5** (e5-small is far below). 70+ languages incl. ru/uk.
  Decoder-only, **last-token pooling** + L2 norm. Usable for retrieval and (via dot-product) reranking.
- **ONNX files**: each variant is 2 files — `.onnx` (graph) + `.onnx_data` (external weights),
  onnxruntime loads them when both sit in the same dir with matching basename.
  → https://huggingface.co/onnx-community/harrier-oss-v1-270m-ONNX/tree/main/onnx
- **Size check vs fleet limits** (embedder ≤600–700 MB, runtime ≤1.5–1.7 GB):
  - `model_quantized.onnx_data` ≈ **328 MB** ✓ (fits embedder budget)
  - `model_q4f16.onnx_data` ≈ 164 MB, `model_q4.onnx_data` ≈ 196 MB, `model_fp16.onnx_data` ≈ 527 MB
  - `model.onnx_data` (fp32) ≈ 1055 MB ✗
- **Inputs/outputs (verified)**: `input_ids` int64, `attention_mask` int64 → `sentence_embedding` [*,640]. No `token_type_ids`.
- **Integration gotchas (verified on prod data)**:
  - Query MUST carry the instruction prefix (`Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery: …`), otherwise performance degrades sharply.
  - Last-token pooling needs a correct mask/EOS handling — naive mean-pad encode gave weak scores (0.18–0.31) on a ru question; with the instruction prefix the relevant chunk ranked #1 for «что за вуз окончил кандидат» but not for «название высшего учебного заведения».
  - Dimension change 384 → 640 requires re-indexing all chunks and a `vec_chunks` schema change (`float[640]`).
- **Verdict**: strong quality, fits the size budget (quantized 328 MB), but non-trivial to wire correctly
  (instruction prompts, last-token pooling, dimension migration). Defer until the retrieval logic is
  proven with the current pipeline; revisit when cross-lingual recall is the bottleneck.

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
