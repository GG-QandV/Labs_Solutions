"""Retrieval + answer generation. Grounding rule is enforced in the prompt AND by the threshold:
if nothing passes the relevance bar, the LLM is never called."""
from __future__ import annotations

import logging
import math
from typing import Any

import httpx

from .. import config
from ..db import db
from ..models.engine import embedder, ner, reranker

log = logging.getLogger("rag.answer")

SYSTEM_RULE = (
    "You answer strictly from the provided document fragments. "
    "If the answer is not supported by them, reply exactly: "
    "\"Not found in the provided documents.\" Never invent facts. "
    "Cite sources inline as [filename, p.N] right after each claim."
)


class NoContext(Exception):
    """Nothing relevant was retrieved — answer without calling the LLM."""


def retrieve(tenant_id: str, question: str) -> list[dict[str, Any]]:
    q_emb = embedder.encode_query(question)
    hits = db.search(tenant_id, q_emb, config.TOP_K)
    if not hits:
        raise NoContext

    scores = reranker.score(question, [h["text"] for h in hits])
    if scores and not math.isnan(scores[0]):
        for h, s in zip(hits, scores, strict=True):
            h["rerank"] = s
        hits.sort(key=lambda h: h["rerank"], reverse=True)
        kept = [h for h in hits if h["rerank"] >= config.RERANK_THRESHOLD]
    else:  # reranker unavailable -> cosine threshold
        kept = [h for h in hits if h["score"] >= config.COSINE_THRESHOLD]

    if not kept:
        raise NoContext
    return kept[: config.TOP_N_CITED]


def build_sources(hits: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for h in hits:
        out.append({
            "filename": h["filename"],
            "page": h["page"],
            "chunk_index": h["chunk_index"],
            "text": h["text"][:1200],
            "score": round(h.get("rerank", h["score"]), 3),
            "entities": ner.entities(h["text"][:1200]),
        })
    return out


def build_prompt(question: str, hits: list[dict[str, Any]]) -> str:
    ctx = "\n\n".join(
        f"[{i + 1}] {h['filename']}, p.{h['page']}:\n{h['text']}" for i, h in enumerate(hits)
    )
    return f"{SYSTEM_RULE}\n\nFragments:\n{ctx}\n\nQuestion: {question}\nAnswer:"


async def ask_llm(prompt: str) -> str:
    if config.LLM_PROVIDER == "zen":
        return await _zen(prompt)
    return await _gemini(prompt)


async def _gemini(prompt: str) -> str:
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{config.GEMINI_MODEL}:generateContent?key={config.GEMINI_API_KEY}")
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(url, json={"contents": [{"parts": [{"text": prompt}]}]})
        if r.status_code == 429:
            raise RuntimeError("LLM rate limit reached (free tier). Please retry in a minute.")
        r.raise_for_status()
        data = r.json()
    return "".join(
        p.get("text", "")
        for cand in data.get("candidates", [])
        for p in cand.get("content", {}).get("parts", [])
    ).strip()


async def _zen(prompt: str) -> str:
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(
            config.ZEN_BASE_URL,
            headers={"authorization": f"Bearer {config.ZEN_API_KEY}"},
            json={"model": config.ZEN_MODEL, "messages": [{"role": "user", "content": prompt}]},
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"].strip()
