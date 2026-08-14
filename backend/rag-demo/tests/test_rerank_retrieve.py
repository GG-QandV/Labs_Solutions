"""Тесты retrieve()-логики: сортировка по rerank, фильтр по cosine, NoContext.
db.search и reranker/embedder мокаются — тестируется чистая логика answer.retrieve.
"""
import math

import pytest

from app import config
from app.rag import answer


@pytest.fixture()
def mock_hits():
    return [
        {"filename": "a.pdf", "page": 1, "chunk_index": 0, "score": 0.80, "text": "обучение университет Киев"},
        {"filename": "a.pdf", "page": 1, "chunk_index": 1, "score": 0.40, "text": "контакты адрес"},
        {"filename": "a.pdf", "page": 2, "chunk_index": 2, "score": 0.60, "text": "навыки работа опыт"},
    ]


def _patch(monkeypatch, hits, rerank_scores=None):
    monkeypatch.setattr(answer.embedder, "encode_query", lambda q: [0.0] * config.EMBED_DIM)
    monkeypatch.setattr(answer.db, "search", lambda tenant, emb, k: hits)
    # дефолт: софт-фильтр выключен (пустой RERANK_THRESHOLD_LOOSE, аудит F3)
    monkeypatch.setattr(config, "RERANK_THRESHOLD_LOOSE", "")
    if rerank_scores is None:
        # reranker unavailable -> NaN fallback (cosine path)
        monkeypatch.setattr(answer.reranker, "score", lambda q, ps: [float("nan")] * len(ps))
        monkeypatch.setattr(answer.reranker, "available", False)
    else:
        monkeypatch.setattr(answer.reranker, "available", True)
        monkeypatch.setattr(answer.reranker, "score", lambda q, ps: list(rerank_scores))


def test_retrieve_filters_by_cosine(monkeypatch, mock_hits):
    monkeypatch.setattr(config, "COSINE_THRESHOLD", 0.55)
    monkeypatch.setattr(config, "TOP_N_CITED", 5)
    _patch(monkeypatch, mock_hits)  # rerank NaN -> cosine path
    kept = answer.retrieve("t", "q")
    assert [h["text"] for h in kept] == ["обучение университет Киев", "навыки работа опыт"]


def test_retrieve_sorts_by_rerank_when_available(monkeypatch, mock_hits):
    monkeypatch.setattr(config, "COSINE_THRESHOLD", 0.0)  # пропускаем всех
    # rerank логиты: контакты(0.40) должен подняться наверх
    _patch(monkeypatch, mock_hits, rerank_scores=[0.1, 5.0, 0.2])
    kept = answer.retrieve("t", "q")
    assert kept[0]["text"] == "контакты адрес"  # highest rerank first


def test_retrieve_no_context_below_threshold(monkeypatch, mock_hits):
    monkeypatch.setattr(config, "COSINE_THRESHOLD", 0.9)  # все ниже
    _patch(monkeypatch, mock_hits)
    with pytest.raises(answer.NoContext):
        answer.retrieve("t", "q")


def test_retrieve_top_n_cited(monkeypatch, mock_hits):
    monkeypatch.setattr(config, "COSINE_THRESHOLD", 0.0)
    monkeypatch.setattr(config, "TOP_N_CITED", 1)
    _patch(monkeypatch, mock_hits)
    kept = answer.retrieve("t", "q")
    assert len(kept) == 1


def test_retrieve_reranker_mock_nan_path():
    """Без весов реальный reranker даёт NaN — ответ.retrieve использует cosine."""
    from app.models.engine import reranker

    assert reranker.available is False
    scores = reranker.score("вопрос", ["пассаж"])
    assert len(scores) == 1 and math.isnan(scores[0])


def test_retrieve_loose_rerank_filter(monkeypatch, mock_hits):
    """RERANK_THRESHOLD_LOOSE: режутся фрагменты с rerank < бар."""
    monkeypatch.setattr(config, "COSINE_THRESHOLD", 0.0)
    _patch(monkeypatch, mock_hits, rerank_scores=[0.1, 5.0, -3.5])
    monkeypatch.setattr(config, "RERANK_THRESHOLD_LOOSE", "-3.0")  # после _patch (тот сбрасывает на "")
    kept = answer.retrieve("t", "q")
    # отсекается третий (rerank -3.5 < -3.0); сортировка по rerank
    assert [h["text"] for h in kept] == ["контакты адрес", "обучение университет Киев"]


def test_retrieve_loose_disabled_when_empty(monkeypatch, mock_hits):
    """Пустой RERANK_THRESHOLD_LOOSE = фильтр выключен (аудит F3)."""
    monkeypatch.setattr(config, "COSINE_THRESHOLD", 0.0)
    monkeypatch.setattr(config, "RERANK_THRESHOLD_LOOSE", "")
    _patch(monkeypatch, mock_hits, rerank_scores=[0.1, 5.0, -3.5])
    kept = answer.retrieve("t", "q")
    assert len(kept) == 3  # ничего не режется
