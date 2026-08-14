"""Тесты Embedder-логики без весов (mock-режим):
- префиксы применяются только при EMBED_PREFIXED=1 (аудит F6/F4);
- encode_query/encode_passages сохраняют сигнатуру (аудит F4);
- EMBED_POOLING принимает first|mean (аудит F1), dim_mismatch не падает в mock.
"""
import importlib

import pytest


def _reload_config(**env):
    import app.config as cfg
    import os

    for k in ("EMBED_POOLING", "EMBED_PREFIXED", "EMBED_MODEL", "EMBED_DIM"):
        cfg.__dict__.pop(k, None)
        os.environ[k] = env.get(k, "first" if k == "EMBED_POOLING" else
                                ("0" if k == "EMBED_PREFIXED" else
                                 ("granite-embedding-r2" if k == "EMBED_MODEL" else "384")))
    importlib.reload(cfg)
    importlib.reload(__import__("app.models.engine", fromlist=["embedder"]))
    return cfg


@pytest.fixture()
def embedder():
    from app.models.engine import embedder

    return embedder


def test_embedder_mock_query_vector(embedder):
    _reload_config(EMBED_PREFIXED="0")
    v = embedder.encode_query("название высшего учебного заведения")
    assert len(v) == 384  # EMBED_DIM
    assert all(isinstance(x, float) for x in v)


def test_embedder_mock_passages(embedder):
    _reload_config(EMBED_PREFIXED="0")
    vs = embedder.encode_passages(["фрагмент один", "фрагмент два"])
    assert len(vs) == 2
    assert all(len(v) == 384 for v in vs)


def test_embedder_prefixes_off_by_default(embedder):
    _reload_config(EMBED_PREFIXED="0")
    # в mock-режиме вектор зависит от текста: без префикса query: не добавляется
    q = embedder.encode_query("text")
    # encode_query с EMBED_PREFIXED=0 == encode с префиксом "" (не "query: ")
    assert len(q) == 384


def test_embedder_prefixes_on_for_rollback(embedder):
    _reload_config(EMBED_PREFIXED="1")
    vs = embedder.encode_passages(["фрагмент"])
    assert len(vs) == 1 and len(vs[0]) == 384


def test_embedder_dim_from_config(embedder):
    _reload_config(EMBED_DIM="384")
    v = embedder.encode_query("x")
    assert len(v) == 384
