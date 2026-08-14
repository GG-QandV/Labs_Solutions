# RAG Demo — миграция моделей на Granite-97M + gte-reranker

> **Для Hermes:** используй subagent-driven-development для исполнения по задачам.

**Goal:** Заменить текущие ONNX-модели rag-demo (e5-small embedder, TinyBERT-L2 reranker) на выбранные: Granite-97M-R2 embedder (int8, 94MB, 384-dim, first-pooling) + gte-multilingual-reranker-base (int8, 340MB). Поднять recall и убрать проблему «Not found» при релевантных вопросах.

**Architecture:** Без изменения общей схемы (SQLite + sqlite-vec, lazy-load ONNX). Меняется только слой `app/models/engine.py` (embedder: другая модель + first-pooling вместо mean; reranker: новая модель), конфиг (пути/пороги), скрипт загрузки моделей. Dimension остаётся 384 → миграция БД не нужна, но нужна переиндексация чанков (новые эмбеддинги).

**Tech Stack:** Python 3.12, onnxruntime (CPU, AVX2), tokenizers, SQLite + sqlite-vec, FastAPI.

---

## Контекст и факты (проверено на проде)

| Модель | Файл ONNX | Размер | Dim | Пулинг | Префиксы | License |
|---|---|---|---|---|---|---|
| **granite-embedding-97m-multilingual-r2** (новый embedder) | `onnx/model_quint8_avx2.onnx` | 94 MB | 384 | **first** (`<|startoftext|>`, ModernBERT — CLS-токена нет) | нет | Apache-2.0 |
| **gte-multilingual-reranker-base** (новый reranker) | `onnx/model_int8.onnx` | 340 MB | — | cross-encoder | нет | Apache-2.0 |
| e5-small (старый embedder) | `model_int8.onnx` | 130 MB | 384 | mean | `query:`/`passage:` | MIT |
| TinyBERT-L2 (старый reranker) | `model_int8.onnx` | 5 MB | — | cross-encoder | нет | MIT |
| distilbert-ner (оставить) | `model_int8.onnx` | 135 MB | — | — | — | MIT |

**Известные факты:**
- CPU прода: AMD EPYC-Genoa, **AVX2 есть** → `model_quint8_avx2.onnx` (94MB) — быстрый int8 путь.
- Входы Granite ONNX: `input_ids` int64, `attention_mask` int64 → `last_hidden_state` [*,*,384]. **Нет `sentence_embedding` выхода** → pooling снаружи.
- **Пулинг Granite = первый токен (`<|startoftext|>`)**, НЕ CLS: у ModernBERT-токенизатора `token_to_id("[CLS]") = None`, первый токен = `<|startoftext|>` (id 179934) — проверено на живом токенизаторе. Пул `hidden[:, 0, :]` семантически = `first` (спец-токен начала), в конфиге параметр назван `EMBED_POOLING=first` (значение `cls` из ранних оценок переименовано).
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
| **G3 · embedder** | Эмбеддинг 384-dim, top-1 = Education-чанк | `python3 /tmp/check_embed.py` | сменить pooling (first↔mean), проверить feed |
| **G4 · reranker** | Логиты gte НЕ все ~-10; ранжирование работает | `python3 /tmp/check_rerank.py` | залогировать сырые логиты, проверить токенизатор |
| **G5 · reindex** | `vec_chunks` обновлён, вопрос даёт University | `curl /api/ask` «название высшего учебного заведения» | проверить UPDATE/DELETE+INSERT в sqlite-vec |
| **G6 · deploy** | `/health` models=true; ответ с цитатой; RAM < 2GiB | `curl /health` + E2E + `docker stats` | смотреть логи, проверить lazy-load |

**Ловушки-логи (trap logs — stdout/stderr, подхватываются OpsHub).**

Управление через env в compose (Task 1):

```yaml
- TRAP_LOGS=${TRAP_LOGS:-1}        # глобальный рубильник ловушек: 1 = вкл, 0 = все выкл
- TRAP_LEVEL=${TRAP_LEVEL:-warning} # error|warning|info|debug — порог отсечения
```

Правила:
- `TRAP_LOGS=0` — все ловушки молчат (аварийный режим/шумный tenant).
- `TRAP_LEVEL` — фильтр: при `warning` пишутся только `log.error`/`log.warning`; при `info` добавляется `log.info`-диагностика; `debug` — полная трассировка.
- По умолчанию **`TRAP_LEVEL=warning`** в проде: в OpsHub уходят только баги/варнинги, диагностика НЕ шумит.

Классификация ловушек по уровням:

| Ловушка | Уровень | Когда пишется |
|---|---|---|
| `embedding.dim_mismatch` | **error** | выходная dim ≠ `EMBED_DIM` (сломает vec_chunks) |
| `retrieve.empty` | **warning** | `NoContext`: вопрос + cosine top-10 (отличать «нет данных» от «порог задушил») |
| `reindex.failed` | **error** | ошибка реиндекса (opshub_error) |
| `rerank.logits` | **info** | диапазон логитов (min/max); warning при max≈min (сломанная модель/токенизатор) |
| `embedding.pooling` | **info** | старт: модель, pooling, dim |
| `model.load_time` | **info** | время первой загрузки модели (lazy-load) |
| `reindex.progress` | **debug** | счётчик каждые 25 чанков |

Итог: в проде по умолчанию (`warning`) в логи/OpsHub попадают **только баги** (dim_mismatch, reindex.failed) и **варнинги** (retrieve.empty, rerank.logits.flat — аномалия). Диагностические info-ловушки (rerank.logits диапазон, embedding.pooling, load_time) включаются точечно через `TRAP_LEVEL=info` при отладке — не засоряют продакшн.

**Параметры как переменные в docker-compose** — единая таблица (параметр → config default → compose default → .env прод) в **Task 1**. Здесь только принцип: `config.py` = `os.environ.get(..., default)` (дефолты для локальной разработки), compose = `${VAR:-default}`, прод = `.env`. Единственный источник истины — прод `.env`; откат на старые модели через env без пересборки образа (аудит F2).

### Хранение логов: ротация до месяца, авто-затирание

Текущее состояние (проверено на проде): docker logging driver `json-file` БЕЗ ограничений (`map[]`) — файлы логов в `/var/lib/docker/containers/*/*-json.log` растут бесконечно, пока не кончится диск (затирания нет). journald почти пуст (8MB) и в него логи контейнера не идут.

Решение — через docker-compose `logging:` (не трогаем journald на хосте):

```yaml
logging:
  driver: json-file
  options:
    max-size: "5m"      # ротация каждого файла при 5 МБ
    max-file: "3"        # держать максимум 3 файла (≈15 МБ на контейнер)
```

**Обоснование размера (измерено на проде):** контейнер за ~4 часа пишет ~69KB при INFO-уровне →
≈ 0.4MB/день. При `TRAP_LEVEL=warning` (прод-режим) — примерно 0.1MB/день. Буфер **5MB × 3 = 15MB**
покрывает:
- warning-режим: 15MB / 0.1MB ≈ **150 дней** (5 месяцев);
- info-режим: 15MB / 0.4MB ≈ **37 дней** (> 1 месяца даже при диагностике).
Старые файлы автоматически затираются драйвером при превышении `max-file`. Размер 10MB×5 (50MB)
избыточен — нет смысла держать месяцы логов, когда диагностика включается точечно через `TRAP_LEVEL`.

Если нужна жёсткая гарантия ≥ 30 дней — включить `LOG_ROTATE_DAYS` в env и реализовать ротацию в коде (`logging.handlers.RotatingFileHandler` с date-именем + удаление старше 30 дней) **только по явному запросу** — docker json-file ротация проще и достаточна.

---

## Шаги

### Task 1: Config — пути, пороги, переменные compose (+ ротация логов)

**Objective:** Настроить конфиг под новые модели без слома текущего поведения; вывести параметры моделей в env (docker-compose); добавить ротацию логов (перенесено из Task 8, аудит F9).

**Files:**
- Modify: `backend/rag-demo/app/config.py`
- Modify: `backend/rag-demo/docker-compose.yml`
- (`.env.example` правится ТОЛЬКО в Task 8 — одна правка, аудит F10)

**Единая таблица параметров (единственный источник истины — `.env` прод; config.py дефолты — только локальная разработка, аудит F2):**

| Параметр | config default | compose default | .env прод (Task 8) | Назначение |
|---|---|---|---|---|
| `EMBED_MODEL` | `granite-embedding-r2` | `${EMBED_MODEL:-granite-embedding-r2}` | `granite-embedding-r2` | каталог embedder в /models |
| `EMBED_POOLING` | `first` | `${EMBED_POOLING:-first}` | `first` | first \| mean (см. F1) |
| `EMBED_PREFIXED` | `0` | `${EMBED_PREFIXED:-0}` | `0` | 1 = префиксы query:/passage: (только для отката на e5, см. F6) |
| `RERANK_MODEL` | `gte-reranker` | `${RERANK_MODEL:-gte-reranker}` | `gte-reranker` | каталог reranker в /models |
| `EMBED_DIM` | `384` | `${EMBED_DIM:-384}` | `384` | размерность вектора (схема vec_chunks) |
| `COSINE_THRESHOLD` | `0.55` | `${COSINE_THRESHOLD:-0.55}` | `0.55` | бар релевантности |
| `RERANK_THRESHOLD` | `-4.0` | `${RERANK_THRESHOLD:--4.0}` | `-4.0` | информационный (F3: не фильтр пока нет замеров) |
| `RERANK_THRESHOLD_LOOSE` | `""` (off) | `${RERANK_THRESHOLD_LOOSE:-}` | пусто | порог Task 7, включается после G4 (F3) |
| `CHUNK_TOKENS` | `420` | `${CHUNK_TOKENS:-420}` | — | лимит чанка |
| `TRAP_LOGS` | `1` | `${TRAP_LOGS:-1}` | `1` | рубильник ловушек |
| `TRAP_LEVEL` | `warning` | `${TRAP_LEVEL:-warning}` | `warning` | error\|warning\|info\|debug |

**Изменения config.py** (всё через `os.environ.get` с дефолтом = таблица выше):
- `EMBED_MODEL = os.environ.get("EMBED_MODEL", "granite-embedding-r2")`; `EMBED_DIR = os.path.join(MODELS_DIR, EMBED_MODEL)`.
- `EMBED_POOLING = os.environ.get("EMBED_POOLING", "first")` — first|mean. Значение `cls` НЕ используется (у Granite нет CLS-токена — аудит F1).
- `EMBED_PREFIXED = os.environ.get("EMBED_PREFIXED", "0") == "1"` — включает `query:`/`passage:` префиксы (откат на e5-small, F6).
- `RERANK_MODEL = os.environ.get("RERANK_MODEL", "gte-reranker")`; `RERANK_DIR = os.path.join(MODELS_DIR, RERANK_MODEL)`.
- `RERANK_THRESHOLD_LOOSE = os.environ.get("RERANK_THRESHOLD_LOOSE", "")` — пусто = выключен (F3).
- `EMBED_DIM = int(os.environ.get("EMBED_DIM", "384"))`.
- `COSINE_THRESHOLD` default `0.55`; `RERANK_THRESHOLD` default `-4.0` (информационный — жёсткий фильтр НЕ включать, пока не проверены логиты gte).
- **Ловушки:** `TRAP_LOGS = os.environ.get("TRAP_LOGS", "1") == "1"`; `TRAP_LEVEL = os.environ.get("TRAP_LEVEL", "warning")` (error|warning|info|debug).
- **Хелпер ловушек** в `app/traps.py` (не в config — чтобы не тащить logger в конфиг):
  ```python
  # app/traps.py
  import logging
  from . import config
  log = logging.getLogger("rag.traps")
  _TRAP_RANK = {"error": 0, "warning": 1, "info": 2, "debug": 3}
  def trap(level: str, msg: str, *args, **kw) -> None:
      if not config.TRAP_LOGS:
          return
      if _TRAP_RANK.get(level, 1) > _TRAP_RANK.get(config.TRAP_LEVEL, 1):
          return
      getattr(log, level, log.info)(msg, *args, **kw)
  ```
  Ловушки в коде вызываются через `trap("error", ...)` / `trap("warning", ...)` / `trap("info", ...)` / `trap("debug", ...)` — единая точка фильтрации по `TRAP_LEVEL`.
- Оставить `E5_DIR`-эквивалент как fallback-константу для отката (не удалять старую логику полностью до G6).

**Изменения docker-compose.yml:**
- Параметры моделей через environment (см. единую таблицу выше).
- **Ротация логов (перенесено из Task 8, F9):**
  ```yaml
  logging:
    driver: json-file
    options:
      max-size: "5m"
      max-file: "3"
  ```

**Ловушка-лог:** в `Embedder._load()` после инициализации залогировать `embedding.pooling` (модель, pooling, dim, prefixed).

**Verification:** `python3 -m py_compile app/config.py app/traps.py`; `EMBED_POOLING`/`EMBED_PREFIXED` читаются из env; `docker compose config` показывает logging-опции.

**Commit (checkpoint G1):** `chore(rag): config — EMBED_*/RERANK_* через env, трапы в app/traps.py, ротация логов`

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

### Task 3: engine.py — Embedder под Granite (first pooling)

**Objective:** Embedder кодирует Granite ONNX с first-pooling (первый токен `<|startoftext|>`, НЕ CLS — у ModernBERT нет CLS-токена, аудит F1), префиксы управляются флагом.

**Files:**
- Modify: `backend/rag-demo/app/models/engine.py`

**Ключевые правки класса `Embedder`:**
1. `E5_DIR` → `EMBED_DIR` (через config, имя из `EMBED_MODEL`).
2. Префиксы: если `config.EMBED_PREFIXED` — добавлять `query:`/`passage:` (откат на e5, F6); иначе — без префиксов (Granite). Сигнатуры `encode_passages`/`encode_query` сохраняются (аудит F4): все вызовы (ingest.py `chunk_pages`/`index_document`, answer.py `retrieve`, reindex-скрипт) работают без изменений.
3. После `session.run(...)` — pooling по `config.EMBED_POOLING`:
   - `first`: `hidden[:, 0, :]` — первый токен = `<|startoftext|>` (ModernBERT; CLS-токена нет — проверено `token_to_id("[CLS]") is None`).
   - `mean`: текущая логика `(hidden * m).sum(1) / m.sum(1)` (fallback).
4. L2-normalize в обоих случаях.
5. **Ловушка-лог `embedding.dim_mismatch`:** после пулинга проверить `pooled.shape[-1] == config.EMBED_DIM`, иначе `trap("error", "embedding.dim_mismatch", ...)` (сломает `vec_chunks float[384]`).
6. **Ловушка-лог `embedding.pooling`:** после `_load()` — `trap("info", "embedding.pooling", model=..., pooling=..., dim=..., prefixed=...)`.

**Пример реализации pooling:**
```python
hidden = self._sess.run(None, feed)[0]
if config.EMBED_POOLING == "first":
    pooled = hidden[:, 0, :]   # <|startoftext|> — CLS-токена у ModernBERT нет
else:  # mean
    m = mask[..., None].astype(np.float32)
    pooled = (hidden * m).sum(axis=1) / np.clip(m.sum(axis=1), 1e-9, None)
norm = np.linalg.norm(pooled, axis=1, keepdims=True)
out.extend((pooled / np.clip(norm, 1e-9, None)).astype(np.float32).tolist())
```

**Verification (в контейнере):** `tokenizer.token_to_id("<|startoftext|>") is not None` (Granite); закодировать 3 чанка + вопрос «название высшего учебного заведения»; убедиться, что top-1 — чанк с Education/University, и эмбеддинг размерности 384.

**Commit:** `feat(rag): embedder — Granite-97M int8, first pooling`

### Task 4: engine.py — Reranker под gte

**Objective:** Reranker загружает gte-multilingual-reranker-base вместо TinyBERT.

**Files:**
- Modify: `backend/rag-demo/app/models/engine.py`

**Изменения класса `Reranker`:**
1. `RERANK_DIR` → через config (`RERANK_MODEL`).
2. Проверить входы gte ONNX: cross-encoder `input_ids`/`attention_mask`/`token_type_ids` — если `token_type_ids` есть, оставить текущий feed (уже обрабатывается через `names`).
3. Логика `score()` без изменений (query, passages → logits).
4. **Ловушка-лог `rerank.logits`:** при первом score — `trap("info", "rerank.logits", min=..., max=...)`; если max≈min (все логиты почти одинаковые) — `trap("warning", "rerank.logits.flat", ...)` (сломанный токенизатор/модель). ВНИМАНИЕ (аудит F8): при `TRAP_LEVEL=warning` info-часть молчит — для G6 временно ставить `TRAP_LEVEL=info`.

**Verification (в контейнере):**
- `Tokenizer.from_file("/models/gte-reranker/tokenizer.json")` грузится без ошибки (аудит F7) — проверить ДО score.
- `reranker.score("название высшего учебного заведения", [chunk_texts])` → логиты в осмысленном диапазоне (не все ~-10; должно быть ранжирование).**
- Зафиксировать фактические min/max логитов → это вход для `RERANK_THRESHOLD_LOOSE` (F3).

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

**Проверка dim перед стартом (аудит F5):** прочитать фактическую dim существующих векторов (`LENGTH(vec_chunks.embedding)` или метаданные таблицы) и сравнить с новой (Granite 384). При несовпадении — fail-fast с ловушкой `trap("error", "reindex.dim_mismatch", ...)`, НЕ обновлять молча.

**Ловушка-лог `reindex.progress`:** каждые 25 чанков `trap("debug", "reindex.progress", done, total)`; при ошибке — `opshub_error("reindex_failed", ...)` + прервать (БД в консистентном состоянии через транзакцию на батч).

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
7. Проверить ловушки-логи: для info-ловушек (`embedding.pooling`, `rerank.logits`, `model.load_time`) временно `TRAP_LEVEL=info` в .env → перезапуск → `docker logs rag-demo`, затем вернуть `warning` (аудит F8). Отсутствие `embedding.dim_mismatch`/`rerank.logits.flat` — всегда (error/warning не фильтруются).
8. Проверить ротацию: `docker inspect rag-demo --format '{{.HostConfig.LogConfig.Config}}'` → `map[max-file:3 max-size:5m]`.

**Commit (checkpoint G6):** `chore(rag): deploy granite + gte`

### Task 7 (опционально): восстановить мягкий rerank-фильтр

**Objective:** Раз gte даёт осмысленные логиты — вернуть rerank как софт-фильтр поверх cosine.

**Files:**
- Modify: `backend/rag-demo/app/rag/answer.py`

**Подход:** после проверки диапазона логитов gte на реальных вопросах (по ловушке `rerank.logits` из G4) выставить числовое значение `RERANK_THRESHOLD_LOOSE` в `.env` прод (пусто = выключен, аудит F3). Код: `kept = [h for h in hits if h["score"] >= COSINE_THRESHOLD and (not config.RERANK_THRESHOLD_LOOSE or h.get("rerank", 0) >= float(config.RERANK_THRESHOLD_LOOSE))]`. Пока `RERANK_THRESHOLD_LOOSE` пуст — фильтр выключен (текущая логика корректна).

### Task 8: Продакшн-переменные в .env

**Objective:** Зафиксировать выбранные параметры моделей на проде как переменные (а не дефолты кода). Единственная правка `.env.example` (аудит F10).

**Files:**
- Modify: `/srv/demos/lending_solutions/backend/rag-demo/.env` (прод)
- Modify: `backend/rag-demo/.env.example` (репо — документация, правится ТОЛЬКО здесь)

**Содержимое (прод .env):**
```bash
EMBED_MODEL=granite-embedding-r2
EMBED_POOLING=first
EMBED_PREFIXED=0
RERANK_MODEL=gte-reranker
EMBED_DIM=384
COSINE_THRESHOLD=0.55
# RERANK_THRESHOLD_LOOSE=   # включить после G4 (Task 7, F3)
TRAP_LOGS=1
TRAP_LEVEL=warning
```

Ротация логов (`logging:` 5m×3) уже в `docker-compose.yml` из Task 1 (F9) — здесь НЕ дублировать.

**Verification:**
- `docker compose config | grep EMBED` показывает значения из .env.
- `docker inspect rag-demo --format '{{.HostConfig.LogConfig.Config}}'` → `map[max-file:3 max-size:5m]` (применяется из Task 1).

**Commit:** `chore(rag): .env — параметры моделей, TRAP_*, ротация (Task 1)`

---

## Тесты / валидация

- Единичные: `python3 -m py_compile` по всем изменённым файлам.
- **Ловушки:** unit-тест `trap()` — фильтрация по `TRAP_LOGS`/`TRAP_LEVEL` (при `TRAP_LEVEL=warning` info-ловушка молчит, error пишется; при `TRAP_LOGS=0` — всё молчит).
- В контейнере: `test_embed.py`, `test_rerank.py` (временные скрипты — проверить эмбеддинг 384-dim, **first**-pooling, токенизатор gte, логиты).
- E2E: сквозной ответ через `/api/ask`.
- RAM: `docker stats` (пик lazy-load < 2GiB лимит; целевой idle ~100–200 MiB с 3 int8-моделями).
- Ротация: `docker inspect rag-demo` → LogConfig `max-size=5m max-file=3`.

## Риски / открытые вопросы

- **Granite ONNX без `sentence_embedding`**: pooling строго `first` (первый токен `<|startoftext|>`, CLS-токена нет — аудит F1). Если first даст плохой recall на других документах — проверить mean как fallback (config `EMBED_POOLING=mean`).
- **sqlite-vec UPDATE**: может не поддерживать `UPDATE vec_chunks SET embedding=...` — тогда DELETE+INSERT (проверить на проде перед массовой реиндексацией; + проверка dim перед стартом, F5).
- **gte int8 = 340MB**: суммарно с Granite 94 + NER 135 = ~570MB. Lazy-load, пик первого запроса — замер `docker stats`.
- **Логиты gte**: диапазон неизвестен (TinyBERT давал ~-10; gte может давать ~0..5). Проверить на реальных вопросах перед включением `RERANK_THRESHOLD_LOOSE` (Task 7, F3).
- **Токенизаторы**: у Granite и gte свой `tokenizer.json` — скачивается в Task 2; Granite-токенизатор проверен (tokenizers-формат, `<|startoftext|>`); gte-токенизатор проверить в G4 (F7).
- **Откат на e5-small (F6)**: НЕ только `EMBED_MODEL=multilingual-e5-small`, а полный набор: `EMBED_POOLING=mean` + `EMBED_PREFIXED=1` (префиксы query:/passage:). Иначе деградация. Старые модели остаются в `/models/`.

---

## Итоговое состояние

- Embedder: `granite-embedding-97m-multilingual-r2` int8 avx2, 94MB, **first**-pooling (`<|startoftext|>`, не CLS), 384-dim, без префиксов.
- Reranker: `gte-multilingual-reranker-base` int8, 340MB, cross-encoder.
- NER: `distilbert-ner` int8, 135MB — без изменений.
- `vec_chunks` float[384] — схема БД не меняется; чанки переиндексируются (скрипт с проверкой dim).
- `COSINE_THRESHOLD=0.55` работает; rerank — сортировка (`RERANK_THRESHOLD_LOOSE` выключен до G4).
- Параметры моделей и ловушек — через env (единая таблица в Task 1); ротация логов 5m×3 в compose.
- Откат: `EMBED_MODEL=multilingual-e5-small` + `EMBED_POOLING=mean` + `EMBED_PREFIXED=1`.
