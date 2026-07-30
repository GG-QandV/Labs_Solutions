"""ONNX inference layer — adapted from Mnemostroma (models/onnx_engine, content_embedder,
reranker, hybrid_ner). Lazy loading: weights are only touched on first use, so a cold
container start (OpsHub launcher) stays fast and idle RAM stays low.

If weights are absent (dev/tests), a deterministic MockEmbedder keeps the pipeline runnable —
never silently in production: /health reports models_loaded=false.
"""
from __future__ import annotations

import hashlib
import logging
import math
import os
import threading
from typing import Any

import numpy as np

from .. import config

log = logging.getLogger("rag.models")

E5_DIR = os.path.join(config.MODELS_DIR, "multilingual-e5-small")
NER_DIR = os.path.join(config.MODELS_DIR, "distilbert-ner")
RERANK_DIR = os.path.join(config.MODELS_DIR, "tinybert-rerank")

_lock = threading.Lock()


def _has(dirpath: str) -> bool:
    return os.path.isfile(os.path.join(dirpath, "model_int8.onnx")) or os.path.isfile(
        os.path.join(dirpath, "model_quint8_avx2.onnx")
    )


def _session(dirpath: str) -> Any:
    import onnxruntime as ort

    for fname in ("model_int8.onnx", "model_quint8_avx2.onnx", "model_quant8.onnx", "model.onnx"):
        p = os.path.join(dirpath, fname)
        if os.path.isfile(p):
            opts = ort.SessionOptions()
            opts.intra_op_num_threads = int(os.environ.get("ONNX_THREADS", "2"))
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            return ort.InferenceSession(p, opts, providers=["CPUExecutionProvider"])
    raise FileNotFoundError(dirpath)


def _tokenizer(dirpath: str) -> Any:
    from tokenizers import Tokenizer

    return Tokenizer.from_file(os.path.join(dirpath, "tokenizer.json"))


# ---------------- embedder ----------------
class Embedder:
    """multilingual-e5-small INT8, 384d, max_length 512. Prefixes: 'query: ' / 'passage: '."""

    max_length = 512

    def __init__(self) -> None:
        self._sess = None
        self._tok = None
        self.available = _has(E5_DIR)

    def _load(self) -> None:
        if self._sess is None:
            with _lock:
                if self._sess is None:
                    self._sess = _session(E5_DIR)
                    self._tok = _tokenizer(E5_DIR)
                    log.info("e5-small loaded")

    def count_tokens(self, text: str) -> int:
        if not self.available:
            return max(1, len(text) // 4)
        self._load()
        return len(self._tok.encode(text).ids)

    def encode(self, texts: list[str], prefix: str) -> list[list[float]]:
        if not texts:
            return []
        if not self.available:
            return [_mock_vector(prefix + t) for t in texts]
        self._load()
        out: list[list[float]] = []
        for i in range(0, len(texts), 8):  # small batches: bounded RAM
            batch = [prefix + t for t in texts[i : i + 8]]
            encs = [self._tok.encode(t) for t in batch]
            maxlen = min(self.max_length, max(len(e.ids) for e in encs))
            ids = np.zeros((len(encs), maxlen), dtype=np.int64)
            mask = np.zeros((len(encs), maxlen), dtype=np.int64)
            for r, e in enumerate(encs):
                n = min(len(e.ids), maxlen)
                ids[r, :n] = e.ids[:n]
                mask[r, :n] = 1
            feed = {"input_ids": ids, "attention_mask": mask}
            names = {i.name for i in self._sess.get_inputs()}
            if "token_type_ids" in names:
                feed["token_type_ids"] = np.zeros_like(ids)
            hidden = self._sess.run(None, {k: v for k, v in feed.items() if k in names})[0]
            m = mask[..., None].astype(np.float32)
            pooled = (hidden * m).sum(axis=1) / np.clip(m.sum(axis=1), 1e-9, None)  # mean pooling
            norm = np.linalg.norm(pooled, axis=1, keepdims=True)
            out.extend((pooled / np.clip(norm, 1e-9, None)).astype(np.float32).tolist())
        return out

    def encode_query(self, text: str) -> list[float]:
        return self.encode([text], "query: ")[0]

    def encode_passages(self, texts: list[str]) -> list[list[float]]:
        return self.encode(texts, "passage: ")


def _mock_vector(text: str) -> list[float]:
    """Deterministic pseudo-embedding for dev/tests (never used when weights are present)."""
    h = hashlib.sha256(text.lower().encode()).digest()
    rng = np.random.default_rng(int.from_bytes(h[:8], "big"))
    base = rng.normal(size=config.EMBED_DIM)
    for word in set(text.lower().split()):
        wh = int.from_bytes(hashlib.sha256(word.encode()).digest()[:8], "big")
        base += np.random.default_rng(wh).normal(size=config.EMBED_DIM) * 3.0
    v = base / (np.linalg.norm(base) + 1e-9)
    return v.astype(np.float32).tolist()


# ---------------- reranker ----------------
class Reranker:
    """ms-marco-TinyBERT-L2-v2 cross-encoder, lazy loaded (4.4 MB)."""

    def __init__(self) -> None:
        self._sess = None
        self._tok = None
        self.available = _has(RERANK_DIR)

    def _load(self) -> None:
        if self._sess is None:
            with _lock:
                if self._sess is None:
                    self._sess = _session(RERANK_DIR)
                    self._tok = _tokenizer(RERANK_DIR)
                    log.info("tinybert reranker loaded")

    def score(self, query: str, passages: list[str]) -> list[float]:
        if not passages:
            return []
        if not self.available:
            return [float("nan")] * len(passages)  # caller falls back to cosine
        self._load()
        self._tok.enable_truncation(max_length=512)
        self._tok.enable_padding()
        encs = self._tok.encode_batch([(query, p) for p in passages])
        ids = np.array([e.ids for e in encs], dtype=np.int64)
        mask = np.array([e.attention_mask for e in encs], dtype=np.int64)
        types = np.array([e.type_ids for e in encs], dtype=np.int64)
        names = {i.name for i in self._sess.get_inputs()}
        feed = {"input_ids": ids, "attention_mask": mask}
        if "token_type_ids" in names:
            feed["token_type_ids"] = types
        logits = self._sess.run(None, {k: v for k, v in feed.items() if k in names})[0]
        return [float(x[0]) if x.shape else float(x) for x in logits]


# ---------------- NER ----------------
class NER:
    """distilbert-base-multilingual-cased-ner-hrl — entity spans for citation highlighting."""

    LABELS = ["O", "B-PER", "I-PER", "B-ORG", "I-ORG", "B-LOC", "I-LOC"]

    def __init__(self) -> None:
        self._sess = None
        self._tok = None
        self.available = _has(NER_DIR)

    def _load(self) -> None:
        if self._sess is None:
            with _lock:
                if self._sess is None:
                    self._sess = _session(NER_DIR)
                    self._tok = _tokenizer(NER_DIR)
                    log.info("distilbert NER loaded")

    def entities(self, text: str) -> list[dict[str, Any]]:
        if not self.available or not text.strip():
            return []
        try:
            self._load()
            enc = self._tok.encode(text[:2000])
            ids = np.array([enc.ids], dtype=np.int64)
            mask = np.array([enc.attention_mask], dtype=np.int64)
            names = {i.name for i in self._sess.get_inputs()}
            feed = {"input_ids": ids, "attention_mask": mask}
            logits = self._sess.run(None, {k: v for k, v in feed.items() if k in names})[0][0]
            preds = logits.argmax(axis=-1)
            out: list[dict[str, Any]] = []
            cur: dict[str, Any] | None = None
            for i, (off, p) in enumerate(zip(enc.offsets, preds, strict=False)):
                label = self.LABELS[p] if p < len(self.LABELS) else "O"
                if label == "O" or off == (0, 0):
                    if cur:
                        out.append(cur); cur = None
                    continue
                kind = label.split("-")[-1]
                if label.startswith("B-") or not cur or cur["type"] != kind:
                    if cur:
                        out.append(cur)
                    cur = {"type": kind, "start": off[0], "end": off[1]}
                else:
                    cur["end"] = off[1]
            if cur:
                out.append(cur)
            for e in out:
                e["text"] = text[e["start"]:e["end"]]
            return out[:20]
        except Exception as exc:  # noqa: BLE001 — NER is decoration, never fatal
            log.warning("NER failed: %s", exc)
            return []


embedder = Embedder()
reranker = Reranker()
ner = NER()


def models_status() -> dict[str, bool]:
    return {"embedder": embedder.available, "reranker": reranker.available, "ner": ner.available}
