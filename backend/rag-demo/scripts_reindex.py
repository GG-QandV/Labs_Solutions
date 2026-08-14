"""scripts_reindex.py — пересоздаёт эмбеддинги всех чанков текущим embedder'ом.

Одноразовый скрипт после миграции моделей (Task 6). Dimension та же (384),
но векторы другие (granite vs e5) → нужна переиндексация.

Безопасность:
- проверка dim существующих векторов vs EMBED_DIM (fail-fast, аудит F5);
- транзакция на батч (при ошибке — откат батча, БД консистентна);
- ловушка reindex.progress (debug) каждые 25 чанков.

Запуск:  python3 scripts_reindex.py
"""
from __future__ import annotations

import logging
import os
import sys

# запуск возможен из любого каталога (docker cp в /tmp): /srv — рабочая директория контейнера
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, "/srv")

from app import config
from app.db import db
from app.models.engine import embedder
from app.traps import trap

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("rag.reindex")

BATCH = 25


def _existing_dim() -> int | None:
    """Определяет размерность текущих векторов по первому чанку.
    sqlite-vec хранит float32 BLOB: length() = dim * 4 байта."""
    row = db.conn.execute("SELECT embedding FROM vec_chunks LIMIT 1").fetchone()
    if not row or row["embedding"] is None:
        return None
    return len(row["embedding"]) // 4


def _update_vector(chunk_id: int, vec: list[float]) -> None:
    from app.db import serialize_f32

    try:
        db.conn.execute("UPDATE vec_chunks SET embedding = ? WHERE chunk_id = ?", (serialize_f32(vec), chunk_id))
    except Exception:  # noqa: BLE001 — sqlite-vec может не поддерживать UPDATE
        db.conn.execute("DELETE FROM vec_chunks WHERE chunk_id = ?", (chunk_id,))
        db.conn.execute("INSERT INTO vec_chunks (chunk_id, embedding) VALUES (?, ?)", (chunk_id, serialize_f32(vec)))


def main() -> int:
    cur = db.conn.execute("SELECT id, text FROM chunks ORDER BY id")
    rows = cur.fetchall()
    if not rows:
        print("Нет чанков для переиндексации.")
        return 0

    existing = _existing_dim()
    if existing is not None and existing != config.EMBED_DIM:
        trap("error", "reindex.dim_mismatch existing=%s expected=%s", existing, config.EMBED_DIM)
        print(f"FAIL: dim существующих векторов {existing} != EMBED_DIM {config.EMBED_DIM}. Прерываю.")
        return 1

    total = len(rows)
    done = 0
    for i in range(0, total, BATCH):
        batch = rows[i : i + BATCH]
        try:
            db.conn.execute("BEGIN")
            for cid, text in batch:
                vec = embedder.encode_passages([text])[0]
                _update_vector(cid, vec)
                done += 1
            db.conn.commit()
        except Exception as e:  # noqa: BLE001
            db.conn.rollback()
            trap("error", "reindex.failed at=%d err=%s", i, e)
            raise
        trap("debug", "reindex.progress done=%d total=%d", done, total)
        log.info("reindex %d/%d", done, total)

    print(f"Готово: {done}/{total} чанков переиндексировано.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
