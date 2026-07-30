# ПРОМПТ ДЛЯ РАЗРАБОТКИ: RAG-демо (v1, VPS Netcup 1000 G12 + Coolify)

Ты — senior Python/full-stack разработчик. Создай демонстрационный RAG-сервис (Retrieval-Augmented Generation): клиент загружает документы, задаёт вопрос и получает ответ строго на основе найденных фрагментов с цитатами-источниками. Деплой — на VPS Netcup 1000 G12 (4 vCore, 8 GB RAM, 256 GB NVMe) через **Coolify** с автодеплоем по push в GitHub. Адрес: `rag.solutions.dpdns.org`.

## Жёсткие ограничения окружения

- На VPS работают и другие демо-сервисы; правило хостинга: **одновременно в RAM — не более 3 демо-стеков**, лишние выгружаются. Этот сервис = **один Docker-контейнер** (UI-статика + API + worker + ONNX-модели + SQLite в одном образе).
- Ресурсный бюджет контейнера: `cpus: 2.0`, `mem_limit: 2048m`. ONNX-модели ~420–650 MB RAM рабочего набора — заложено в бюджет.
- **Coolify** ставится на VPS как панель деплоя (само по себе ~0.5–1.5 GB RAM на свои контейнеры + Traefik как reverse proxy вместо Caddy). GitHub-репозиторий подключается к Coolify; push в main → авто-сборка и деплой. Домены/HTTPS выдаёт Traefik/Coolify.
- Никакого torch/transformers/LangChain — только onnxruntime + tokenizers (стек Mnemostroma).
- Python 3.12, менеджер пакетов **uv** (без venv-ритуалов: `uv sync`, `uv run`). Backend: **FastAPI**.

## Переиспользуемый код (проект Mnemostroma)

Источник: https://github.com/GG-QandV/mnemostroma — взять модуль `models/` целиком и адаптировать:

| Файл                                                                       | Роль в RAG-демо                                            |
| -------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `models/onnx_engine.py`, `engine_pool.py`, `protocol.py`, `mock_engine.py` | Движок инференса ONNX + пул + мок для тестов               |
| `models/content_embedder.py`, `embedding_utils.py`                         | Эмбеддинги e5-small (384d, префиксы `query:` / `passage:`) |
| `models/reranker.py` (+ `memory/reranker.py` как референс)                 | Cross-encoder TinyBERT rerank top-k                        |
| `models/hybrid_ner.py`, `bert_ner.py`                                      | NER — подсветка сущностей в цитатах                        |
| `models_manifest.json`                                                     | Манифест весов, скачивание при сборке образа               |

Модели (ONNX INT8, суммарно ~300 MB диск): multilingual-e5-small (384d, max 512 ток.), distilbert-multilingual-NER, ms-marco-TinyBERT-L2-v2 (реранкер, lazy load, fallback quant8 для CPU без AVX2). Веса скачиваются на этапе сборки Docker-образа с HuggingFace (Xenova/*), в образ не коммитятся.

Второй вариант (context-manager: TS + Qdrant + Postgres) — **отклонён**: два лишних контейнера БД против бюджета RAM.

## Хранилище

**SQLite + sqlite-vec** (расширение векторного поиска для SQLite) — один файл `/data/rag.db`, WAL-режим:

- Таблицы: `users` (регистрация), `sessions` (демо-токены), `documents`, `chunks` (text, page, chunk_index, metadata), виртуальная таблица `vec_chunks` (embedding float[384]), `chat_history` (только для зарегистрированных).
- Metadata чанка: `tenant_id, demo_id, document_id, filename, page, chunk_index, created_at`. Все поисковые запросы фильтруются по `tenant_id` текущей сессии.
- Никаких Qdrant/Postgres.

## LLM и OCR (внешние API)

- **Основной провайдер: Google Gemini, free tier** (только Flash/Flash-Lite; лимиты по источникам расходятся — от 250 до 1500 запросов/день на Flash, 10–15 RPM; при 429 — экспоненциальный backoff). Ключ — переменная окружения `GEMINI_API_KEY`.
- **Ответы на вопросы**: Gemini Flash. Конфигом переключается на DeepSeek (`deepseek-chat`, OpenAI-совместимый endpoint, `DEEPSEEK_API_KEY`) — DeepSeek дешевле при платном использовании, но **не имеет vision** и для OCR непригоден.
- **OCR сканированных страниц**: подход zerox (getomni-ai/zerox / форк GG-QandV/ocr-pipeline) — страница PDF → изображение → vision-запрос Gemini Flash → markdown. Только для страниц без текстового слоя.
- Текстовые документы извлекаются **локально**: PDF — PyMuPDF, DOCX — python-docx, TXT — как есть. XLSX не поддерживается в демо (сокращённый вариант).
- Промпт LLM обязан содержать правило: «Если ответа нет в переданных фрагментах — скажи, что в документах не найдено подтверждения. Не придумывай». Ответ — с citations в формате `[filename, p.N]`.

## Пайплайн индексации

```
PDF/DOCX/TXT → magic bytes + лимит размера
  → извлечение текста (локально) | OCR через Gemini vision (только сканы)
  → очистка → chunks ≤450 токенов e5-токенизатора, overlap 60–80
  → embedding "passage: {chunk}" (локально, e5-small)
  → sqlite-vec insert + metadata
Статусы в UI: «extracting → indexing → ready», по одному документу за раз (одна очередь на tenant).
```

Лимит 512 токенов e5-small — жёсткий: чанк с префиксом не должен превышать 500 токенов (обрезка запрещена, чанкер обязан резать раньше).

## Пайплайн ответа

```
Вопрос → embedding "query: {q}" (локально)
  → sqlite-vec search top_k=10, WHERE tenant_id = current
  → reranker TinyBERT → top-5
  → порог релевантности: rerank-score ниже порога (конфиг, стартово подобрать эмпирически) → «в документах не найдено»
  → Gemini: вопрос + 5 фрагментов → ответ
UI: ответ + блок «Sources»: filename, страница, текст фрагмента, NER-подсветка сущностей; клик — открыть фрагмент в контексте документа.
```

## Лимиты демо

| Параметр         | Значение                                                 |
| ---------------- | -------------------------------------------------------- |
| Файлов за сессию | до 5, суммарно **до 10 страниц** (5×2, 2×5 и т.п.)       |
| Размер           | до 10 MB/файл (конфиг)                                   |
| Форматы          | PDF, DOCX, TXT                                           |
| Индексация       | 1 активная задача на tenant, очередь                     |
| OCR              | максимум 10 страниц/сессию (совпадает с лимитом страниц) |
| Вопросов         | 20/час на tenant (конфиг)                                |
| Глобально        | суточный счётчик Gemini-вызовов с запасом под free tier  |

Предзагруженный тестовый набор: 2–3 небольших документа в общем read-only tenant `demo-public`, доступен без загрузки своих файлов.

## Пользователи и сессии

- **Анонимная демо-сессия**: временный токен (TTL 1 час, как в PDF-демо), данные клиента ни для кого больше не видны (tenant-изоляция).
- **Регистрация (опционально для клиента)**: форма → письмо-подтверждение через **Resend** (общий домен `solutions.dpdns.org` и общая квота 100 писем/день с PDF-демо — суточный счётчик писем общий, хранить в SQLite этого сервиса лимит ≤30/день на RAG). Зарегистрированным доступна история чатов.
- Дисклеймер при загрузке: «Demo only. Upload test files without any sensitive or valuable content. All data is wiped daily.»

## Очистка данных

- Ежедневно в **03:00** (по времени сервера): полная очистка анонимных tenant'ов — файлы, chunks, векторы, сессии.
- За 15 минут до очистки активным сессиям показывается предупреждение с кнопкой **«Postpone cleanup by 1 hour»** (одно продление на сессию).
- Данные зарегистрированных пользователей: хранятся 7 дней (конфиг), затем та же очистка.

## Структура репозитория

```
/app
  /api            — FastAPI: auth, upload, jobs, ask, sources, health
  /worker         — задачи индексации (asyncio-очередь в том же процессе)
  /rag            — chunker, retriever (sqlite-vec), rerank, prompt-builder, citations
  /models         — адаптированные модули Mnemostroma (onnx_engine, embedder, ner, reranker)
  /ocr            — zerox-подход: pdf→png→Gemini vision
  /web            — статика UI (лёгкий Vite/React или vanilla — минимум зависимостей), раздаёт FastAPI
/data             — volume: rag.db + загруженные файлы (в .gitignore)
Dockerfile        — multi-stage: uv sync → скачивание ONNX-весов → runtime-слой
pyproject.toml, uv.lock
coolify: healthcheck GET /health (модели загружены, sqlite-vec доступен)
```

## Деплой через Coolify

1. Установить Coolify на VPS (официальный скрипт), убедиться что Docker уже стоит; Traefik Coolify занимает 80/443 — **существующий Caddy из PDF-демо мигрирует под Coolify или отключается** (зафиксировать выбранный вариант в README).
2. Подключить GitHub-репозиторий, ветка main, build = Dockerfile.
3. Домен `rag.solutions.dpdns.org` в Coolify (DNS A-запись в Cloudflare → IP VPS); HTTPS автоматически.
4. Переменные окружения: `GEMINI_API_KEY`, `RESEND_API_KEY`, `DEEPSEEK_API_KEY` (опц.), лимиты.
5. Ресурсные лимиты контейнера в Coolify: 2 CPU / 2 GB.
6. Smoke-чеклист: тестовый набор → вопрос → ответ с цитатами; загрузка своего PDF (текстовый) → индексация → вопрос; скан-PDF → OCR-ветка; вопрос вне документов → «не найдено»; регистрация → письмо-подтверждение; в 02:45 — предупреждение об очистке.

## Не реализовывать (зона роста)

XLSX, массовая загрузка, мультиязычный UI (старт EN), роли, платные тарифы, стриминг ответов, ClamAV, Qdrant/Postgres-вариант, горизонтальное масштабирование.

## Критерий готовности

1. Открытие rag.solutions.dpdns.org → тестовый набор + «Upload your files».
2. Загрузка до 5 файлов/10 страниц → статусы extracting → indexing → ready.
3. Вопрос в чате → ответ + 5 источников (файл, страница, фрагмент, NER-подсветка).
4. Вопрос без ответа в документах → честное «не найдено», без выдумок.
5. Сканированный PDF → OCR через Gemini vision → индексируется как обычный.
6. Изоляция: чужие документы недоступны, очистка в 03:00 с предупреждением и отсрочкой.
7. Регистрация с email-подтверждением (Resend) → история чатов.
8. Контейнер один, ≤2 GB RAM, автодеплой по git push через Coolify.
