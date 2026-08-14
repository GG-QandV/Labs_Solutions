# RAG Demo — миграция моделей на Granite-97M + gte-reranker

> **Для Hermes:** используй subagent-driven-development для исполнения по задачам.

**Goal:** Заменить текущие ONNX-модели rag-demo (e5-small embedder, TinyBERT-L2 reranker) на выбранные: Granite-97M-R2 embedder (int8, 94MB, 384-dim, CLS pooling) + gte-multilingual-reranker-base (int8, 340MB). Поднять recall и убрать проблему «Not found» при релевантных вопросах.

**Architecture:** Без изменения общей схемы (SQLite + sqlite-vec, lazy-load ONNX). Меняется только слой `app/models/engine.py` (embedder: другая модель + CLS pooling вместо mean; reranker: новая модель), конфиг (пути/пороги), скрипт загрузки моделей. Dimension остаётся 384 → миграция БД не нужна, но нужна переиндексация чанков (новые эмбеддинги).

**Tech Stack:** Python 3.12, onnxruntime (CPU, AVX2), tokenizers, SQLite + sqlite-vec, FastAPI.

---

## Контекст и факты (проверено на проде)

| Модель | Файл ONNX | Размер | Dim | Пулинг | Префиксы | License |
|---|---|---|---|---|---|---|
| **granite-embedding-97m-multilingual-r2** (новый embedder) | `onnx/model_quint8_avx2.onnx` | 94 MB | 384 | **CLS** (`pooling_mode_cls_token=true`) | нет | Apache-2.0 |
| **gte-multilingual-reranker-base** (новый reranker) | `onnx/model_int8.onnx` | 340 MB | — | cross-encoder | нет | Apache-2.0 |
| e5-small (старый embedder) | `model_int8.onnx` | 130 MB | 384 | mean | `query:`/`passage:` | MIT |
| TinyBERT-L2 (старый reranker) | `model_int8.onnx` | 5 MB | — | cross-encoder | нет | MIT |
| distilbert-ner (оставить) | `model_int8.onnx` | 135 MB | — | — | — | MIT |

**Известные факты:**
- CPU прода: AMD EPYC-Genoa, **AVX2 есть** → `model_quint8_avx2.onnx` (94MB) — быстрый int8 путь.
- Входы Granite ONNX: `input_ids` int64, `attention_mask` int64 → `last_hidden_state` [*,*,384]. **Нет `sentence_embedding` выхода** → pooling снаружи (CLS).
- Granite не требует префиксов; скоуры 0.68–0.79 (порог cosine 0.55 работает).
- gte-reranker входы: cross-encoder (query, passage) — совместим с текущим `reranker.score()` без правок кода.
- Текущий `retrieve()` уже переведён на «rerank = сортировка, фильтр по cosine 0.55» (коммит 9cb8ec3). После gte можно вернуть мягкий rerank-порог.
- `scripts_download_models.py` качает в `/models/<name>/` файлы `<src>:<dst>` — надо расширить под Granite (только 1 файл + tokenizer) и gte (int8 + tokenizer).
- NER-модель (distilbert-ner) остаётся без изменений.

---

## Контрольные точки (gates) и ловушки-логи

Каждая задача = отдельный коммит (TDD: RED → GREEN → refactor). Checkpoint-коммиты НЕ переписывать.

| Gate | Что проверяем | Команда/критерий | Fail-действие |
|---|---|---|---|
| **G1 · config** | `py_compile` ок; новые переменные читаются | `python3 -m py_compile app/config.py` | вернуть, пока не компилируется |
| **G2 · download** | Файлы моделей на месте, размеры совпадают | `ls -la /models/granite-embedding-r2/ /models/gte-reranker/` (94MB / 340MB / tokenizer.json) | скачать заново, проверить сеть HF |
| **G3 · embedder** | Эмбеддинг 384-dim, top-1 = Education-чанк | `python3 /tmp/check_embed.py` | сменить pooling (cls↔mean), проверить feed |
| **G4 · reranker** | Логиты gte НЕ все ~-10; ранжирование работает | `python3 /tmp/check_rerank.py` | залогировать сырые логиты, проверить токенизатор |
| **G5 · reindex** | `vec_chunks` обновлён, вопрос даёт University | `curl /api/ask` «название высшего учебного заведения» | проверить UPDATE/DELETE+INSERT в sqlite-vec |
| **G6 · deploy** | `/health` models=true; ответ с цитатой; RAM < 2GiB | `curl /health` + E2E + `docker stats` | смотреть логи, проверить lazy-load |

**Ловушки-логи** (trap logs — писать в stdout/stderr, подхватываются OpsHub):
1. **`embedding.pooling`** — при старте/первом encode логировать выбранный pooling и размерность: `log.info("embedder ready: model=%s pooling=%s dim=%s", path, cfg.EMBED_POOLING, dim)`.
2. **`embedding.dim_mismatch`** — если выходная размерность ≠ config.EMBED_DIM → `log.error` (сломает вставку в vec_chunks float[384]).
3. **`rerank.logits`** — при первом score логировать диапазон логитов: `log.info("rerank logits: min=%.2f max=%.2f", min, max)`. Если все близки (~одинаковые) — подозрение на сломанную модель/токенизатор.
4. **`retrieve.empty`** — при `NoContext` логировать вопрос + скоуры top-10 (cosine), чтобы отличать «нет данных» от «порог задушил». Это ключевая ловушка против повтора бага «Not found».
5. **`reindex.progress`** — каждые N чанков логировать счётчик (N=25), при ошибке — `opshub_error("reindex_failed", ...)`.
6. **`model.load_time`** — замерять время первой загрузки каждой модели (lazy-load): `log.info("model %s loaded in %.1fs", name, dt)`.

**Параметры как переменные в docker-compose** (не хардкод в config.py по умолчанию — см. Task 1):

```yaml
environment:
  - EMBED_MODEL=granite-embedding-r2          # имя каталога в /models
  - EMBED_POOLING=${EMBED_POOLING:-cls}        # cls | mean
  - RERANK_MODEL=${RERANK_MODEL:-gte-reranker}
  - EMBED_DIM=${EMBED_DIM:-384}
  - COSINE_THRESHOLD=${COSINE_THRESHOLD:-0.55}
  - RERANK_THRESHOLD=${RERANK_THRESHOLD:--4.0}
  - CHUNK_TOKENS=${CHUNK_TOKENS:-420}
```

В `config.py` — только `os.environ.get(..., default)`, default = текущие значения (обратная совместимость). Продакшн-значения задаются в `/srv/demos/lending_solutions/.env` (или в compose). Это даёт: быстрый откат на старые модели через env без пересборки образа.

---

## Шаги

### Task 1: Config — пути, пороги, переменные compose

**Objective:** Настроить конфиг под новые модели без слома текущего поведения; вывести параметры моделей в env (docker-compose).

**Files:**
- Modify: `backend/rag-demo/app/config.py`
- Modify: `backend/rag-demo/docker-compose.yml`
- Modify: `backend/rag-demo/.env.example`

**Изменения config.py** (всё через `os.environ.get` с дефолтом = текущие значения):
- `EMBED_MODEL = os.environ.get("EMBED_MODEL", "granite-embedding-r2")` — имя каталога в `/models`.
- `EMBED_DIR = os.path.join(MODELS_DIR, EMBED_MODEL)`.
- `EMBED_POOLING = os.environ.get("EMBED_POOLING", "cls")` — cls|mean.
- `RERANK_MODEL = os.environ.get("RERANK_MODEL", "gte-reranker")`; `RERANK_DIR = os.path.join(MODELS_DIR, RERANK_MODEL)`.
- `EMBED_DIM = int(os.environ.get("EMBED_DIM", "384"))`.
- `COSINE_THRESHOLD` default `0.55`; `RERANK_THRESHOLD` default `-4.0` (информационный — жёсткий фильтр НЕ включать, пока не проверены логиты gte).
- Оставить `E5_DIR`-эквивалент как fallback-константу для отката (не удалять старую логику полностью до G6).

**Изменения docker-compose.yml** — параметры моделей через environment (см. блок выше в «Параметры как переменные»), дефолты в `.env.example`:
```yaml
- EMBED_MODEL=${EMBED_MODEL:-granite-embedding-r2}
- EMBED_POOLING=${EMBED_POOLING:-cls}
- RERANK_MODEL=${RERANK_MODEL:-gte-reranker}
- EMBED_DIM=${EMBED_DIM:-384}
- COSINE_THRESHOLD=${COSINE_THRESHOLD:-0.55}
```

**Ловушка-лог:** в `Embedder._load()` после инициализации залогировать `embedding.pooling` (модель, pooling, dim).

**Verification:** `python3 -m py_compile app/config.py`; `EMBED_POOLING` читается из env.

**Commit (checkpoint G1):** `chore(rag): config — EMBED_MODEL/RERANK_MODEL/EMBED_POOLING/EMBED_DIM через env (compose)`

### Task 2: scripts_download_models.py — новые модели

**Objective:** Скрипт качает Granite int8 avx2 + gte int8 + токенизаторы.

**Files:**
- Modify: `backend/rag-demo/scripts_download_models.py`

**Изменения:** добавить TARGETS:
```python
("granite-embedding-r2", f"{BASE}/ibm-granite/granite-embedding-97m-multilingual-r2/resolve/main",
 ["onnx/model_quint8_avx2.onnx:model_int8.onnx", "tokenizer.json"]),
("gte-reranker", f"{BASE}/onnx-community/gte-multilingual-reranker-base/resolve/main",
 ["onnx/model_int8.onnx:model_int8.onnx", "tokenizer.json"]),
```
Оставить e5-small/tinybert/ner targets (для отката) ИЛИ удалить — на усмотрение; рекомендую оставить e5+tinybert, NER обязательно.

**Verification:** `python3 scripts_download_models.py` в контейнере (модели появятся в `/models/granite-embedding-r2/` и `/models/gte-reranker/`).

**Commit:** `feat(rag): download scripts для granite + gte`

### Task 3: engine.py — Embedder под Granite (CLS pooling)

**Objective:** Embedder кодирует Granite ONNX с CLS pooling (вместо mean), без префиксов.

**Files:**
- Modify: `backend/rag-demo/app/models/engine.py`

**Ключевые правки класса `Embedder`:**
1. `E5_DIR` → `EMBED_DIR` (через config, имя из `EMBED_MODEL`).
2. Убрать префиксы: `encode(texts, prefix="")` — Granite без `query:`/`passage:`. Сохранить совместимость сигнатуры `encode_passages`/`encode_query`.
3. После `session.run(...)` — pooling по `config.EMBED_POOLING`:
   - `cls`: `hidden[:, 0, :]`
   - `mean`: текущая логика `(hidden * m).sum(1) / m.sum(1)` (fallback).
4. L2-normalize в обоих случаях.
5. **Ловушка-лог `embedding.dim_mismatch`:** после пулинга проверить `pooled.shape[-1] == config.EMBED_DIM`, иначе `log.error` (сломает `vec_chunks float[384]`).

**Пример реализации pooling:**
```python
hidden = self._sess.run(None, feed)[0]
if config.EMBED_POOLING == "cls":
    pooled = hidden[:, 0, :]
else:  # mean
    m = mask[..., None].astype(np.float32)
    pooled = (hidden * m).sum(axis=1) / np.clip(m.sum(axis=1), 1e-9, None)
norm = np.linalg.norm(pooled, axis=1, keepdims=True)
out.extend((pooled / np.clip(norm, 1e-9, None)).astype(np.float32).tolist())
```

**Verification (в контейнере):** закодировать 3 чанка + вопрос «название высшего учебного заведения»; убедиться, что top-1 — чанк с Education/University, и эмбеддинг размерности 384.

**Commit:** `feat(rag): embedder — Granite-97M int8, CLS pooling`

### Task 4: engine.py — Reranker под gte

**Objective:** Reranker загружает gte-multilingual-reranker-base вместо TinyBERT.

**Files:**
- Modify: `backend/rag-demo/app/models/engine.py`

**Изменения класса `Reranker`:**
1. `RERANK_DIR` → через config (`RERANK_MODEL`).
2. Проверить входы gte ONNX: cross-encoder `input_ids`/`attention_mask`/`token_type_ids` — если `token_type_ids` есть, оставить текущий feed (уже обрабатывается через `names`).
3. Логика `score()` без изменений (query, passages → logits).
4. **Ловушка-лог `rerank.logits`:** при первом score — `log.info("rerank logits min=%.2f max=%.2f", min, max)`. Если max≈min (все логиты почти одинаковые) — `log.warning` (сломанный токенизатор/модель).

**Verification:** `reranker.score("название высшего учебного заведения", [chunk_texts])` → логиты в осмысленном диапазоне (не все ~-10; должно быть ранжирование).**

**Commit (checkpoint G4):** `feat(rag): reranker — gte-multilingual-reranker-base int8`

### Task 5: Переиндексация чанков

**Objective:** Пересоздать эмбеддинги всех существующих чанков под Granite (dim та же 384, но новые векторы).

**Files:**
- Create: `backend/rag-demo/scripts_reindex.py` (одноразовый)

**Скрипт:**
```python
# для каждого chunk: прочитать text, закодировать embedder.encode_passages([text]),
# обновить vec_chunks.embedding через UPDATE (вставка с тем же chunk_id).
```
Внимание: `vec_chunks` — virtual table с `embedding float[384]`; обновление = `UPDATE vec_chunks SET embedding = ? WHERE chunk_id = ?` (проверить, поддерживает ли sqlite-vec UPDATE; если нет — DELETE+INSERT). **Проверить на тестовой копии БД перед продакшеном.**

**Ловушка-лог `reindex.progress`:** каждые 25 чанков `log.info("reindex %d/%d", done, total)`; при ошибке — `opshub_error("reindex_failed", ...)` + прервать (БД в консистентном состоянии через транзакцию на батч).

**Verification:** после реиндекса вопрос «название высшего учебного заведения» через `retrieve()` возвращает чанк с University (cosine ≥ 0.55), а не NoContext.

**Commit (checkpoint G5):** `feat(rag): reindex под granite`

### Task 6: Деплой и E2E

**Objective:** Пересобрать контейнер, задеплоить, проверить сквозной ответ.

**Steps:**
1. `scp` изменённых файлов на прод `/srv/demos/lending_solutions/backend/rag-demo/`.
2. `docker compose build rag-demo && docker compose up -d rag-demo`.
3. Проверить `GET /health` → `models.embedder=true, models.reranker=true`.
4. E2E через API: загрузить резюме → спросить «название высшего учебного заведения» → ожидать ответ с «Kyiv National Economic University» и цитатой `[filename, p.N]`.
5. Проверить скоуры в `sources` (cosine ~0.6+).
6. Проверить RAM: `docker stats rag-demo` — пик при первом запросе, затем idle (lazy-load).
7. Проверить ловушки-логи в `docker logs rag-demo`: искать `embedding.pooling`, `rerank.logits`, `model.load_time`; отсутствие `embedding.dim_mismatch`.

**Commit (checkpoint G6):** `chore(rag): deploy granite + gte`

### Task 7 (опционально): восстановить мягкий rerank-фильтр

**Objective:** Раз gte даёт осмысленные логиты — вернуть rerank как софт-фильтр поверх cosine.

**Files:**
- Modify: `backend/rag-demo/app/rag/answer.py`

**Подход:** после проверки диапазона логитов gte на реальных вопросах (по ловушке `rerank.logits`) — `kept = [h for h in hits if h["score"] >= COSINE_THRESHOLD and (not scores or h.get("rerank", 0) >= RERANK_THRESHOLD_LOOSE)]`. Пока логиты не проверены — НЕ включать (текущая логика корректна).

### Task 8: Продакшн-переменные в .env / compose

**Objective:** Зафиксировать выбранные параметры моделей на проде как переменные (а не дефолты кода).

**Files:**
- Modify: `/srv/demos/lending_solutions/backend/rag-demo/.env` (прод)
- Modify: `backend/rag-demo/.env.example` (репо — документация)

**Содержимое (прод .env):**
```bash
EMBED_MODEL=granite-embedding-r2
EMBED_POOLING=cls
RERANK_MODEL=gte-reranker
EMBED_DIM=384
COSINE_THRESHOLD=0.55
```

**Verification:** `docker compose config | grep EMBED` показывает значения из .env.

**Commit:** `chore(rag): .env.example — параметры моделей (документация)`

---

## Тесты / валидация

- Единичные: `python3 -m py_compile` по всем изменённым файлам.
- В контейнере: `test_embed.py`, `test_rerank.py` (временные скрипты — проверить эмбеддинг 384-dim, CLS, логиты gte).
- E2E: сквозной ответ через `/api/ask`.
- RAM: `docker stats` (пик lazy-load < 2GiB лимит; целевой idle ~100–200 MiB с 3 int8-моделями).

## Риски / открытые вопросы

- **Granite ONNX без `sentence_embedding`**: pooling строго CLS. Если CLS даст плохой recall на других документах — проверить mean как fallback (config `EMBED_POOLING`).
- **sqlite-vec UPDATE**: может не поддерживать `UPDATE vec_chunks SET embedding=...` — тогда DELETE+INSERT (проверить на проде перед массовой реиндексацией).
- **gte int8 = 340MB**: суммарно с Granite 94 + NER 135 = ~570MB. Lazy-load, пик первого запроса — замер `docker stats`.
- **Логиты gte**: диапазон неизвестен (TinyBERT давал ~-10; gte может давать ~0..5). Проверить на реальных вопросах перед включением rerank-фильтра (Task 7).
- **Токенизаторы**: у Granite и gte свой `tokenizer.json` — скачивается в Task 2; проверить что `Tokenizer.from_file` грузит их (формат HF tokenizers).
- **Откат**: старые модели e5/tinybert остаются в `/models/` — переключение через config (пути), быстрый rollback.

---

## Итоговое состояние

- Embedder: `granite-embedding-97m-multilingual-r2` int8 avx2, 94MB, CLS pooling, 384-dim.
- Reranker: `gte-multilingual-reranker-base` int8, 340MB, cross-encoder.
- NER: `distilbert-ner` int8, 135MB — без изменений.
- `vec_chunks` float[384] — схема БД не меняется; чанки переиндексируются.
- `COSINE_THRESHOLD=0.55` работает; rerank — сортировка (софт-фильтр после замера логитов).
