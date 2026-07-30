# СПЕКА: LLM-модуль stt-mvp (перевод/редактура/подсказки/саммари)

Единственная точка интеграции с облачной моделью — `/api/llm/*`. STT-пайплайн и UI
не знают ни провайдера, ни текста промпта.

## Контракт эндпоинтов

| Метод | Путь | Назначение |
|---|---|---|
| POST | /api/llm/translate | Сегмент → {translation, changes[], hints[]?, action_items[]?, is_question?} |
| POST | /api/llm/summary | Транскрипт → {summary, key_moments[], risks[]}; 409 если секция выключена |
| GET/PUT | /api/llm/prompt-config | Просмотр/правка YAML-конфига промпта; PUT валидирует до записи, hot reload без рестарта |
| GET | /api/llm/prompt-preview | Точный собранный системный промпт (отладка/UI) |
| POST/DELETE | /api/llm/byok[/id] | BYOK-сессия: ключ только в RAM, TTL 60 мин, Revoke |
| GET | /api/llm/health | Провайдер, модель, наличие server-key, включённые секции |

## Системный промпт = файл config/llm_prompt.yaml

Секции с независимыми enabled-флагами, порядок сборки фиксирован:
core (неотключаемая) → editor (live_literal/post_clean) → glossary → register →
**hints** (подсказки-ответы на языке перевода, отключаемая — по ТЗ) →
action_items → question_flag; **summary_rules** (отключаемая — по ТЗ) — только для /summary.
JSON-схема ответа в промпте генерируется из включённых секций (модель не просят
поля, которые сервис не ждёт). Плейсхолдеры: {source_lang} {target_lang} {mode}
{glossary} {max_hints}. Правка = редактирование файла или PUT; кода не касается.

## Провайдеры (env)

LLM_PROVIDER=openai|gemini; openai-совместимый (DeepSeek по умолчанию:
LLM_BASE_URL=https://api.deepseek.com, LLM_MODEL=deepseek-chat) или Gemini
(GEMINI_MODEL=gemini-2.5-flash, responseMimeType=application/json).
Backoff: 1s/2s, максимум 3 попытки, retryable только 429/5xx/network.
LogRedactor маскирует ключи (sk-*, AIza*, Bearer) до записи любого лога.

## Что ещё желательно от большой модели (реализовано выключенными секциями)

- glossary — принудительная терминология (стабильность переводов терминов между сегментами);
- register — фиксация делового регистра («вы»-форма);
- action_items — извлечение обязательств {who, what, due} прямо в live (дороже по токенам);
- question_flag — пометка прямых вопросов к пользователю для подсветки в UI.
Рекомендуется НЕ включать в live_literal одновременно hints+action_items+question_flag
на free-tier: рост латентности и токенов на каждый сегмент.
