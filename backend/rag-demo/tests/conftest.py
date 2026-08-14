"""pytest config: поднимаем тестовое окружение до импорта app.

ONNX-моделей в тестовом окружении нет → Embedder/Reranker падают в mock-режим
(available=False), что и нужно для unit-тестов логики (pooling-выбор, префиксы,
ловушки) без весов.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(__file__))

os.environ.setdefault("RAG_DB", ":memory:")
os.environ.setdefault("RAG_FILES", "/tmp/rag-test-files")
os.environ.setdefault("MODELS_DIR", "/tmp/rag-test-models")


@pytest.fixture(autouse=True)
def _reset_env(monkeypatch):
    """Каждый тест стартует с консистентным окружением ловушек."""
    monkeypatch.setenv("TRAP_LOGS", "1")
    monkeypatch.setenv("TRAP_LEVEL", "warning")
    yield
