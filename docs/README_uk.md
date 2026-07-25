[🇬🇧 English](../README.md) &nbsp;|&nbsp; [🇷🇺 Русский](README_ru.md)

# Labs Solutions

AI-автоматизації та лендинг-рішення для бізнесу.

Демонстрація робочих AI-автоматизацій на реальних сценаріях — вилучення даних, перевірка, бізнес-правила, підтвердження людиною та експорт у CRM, email, PDF, задачі та звіти.

## Вміст

- `docs/` — специфікації, промпти, архітектурний аналіз, гайди деплою
  - `docs/speech_translate/` — локальний STT + хмарний переклад MVP
- `backups/` — архіви проєктів (tar.gz, zip): білди лендингів, модулі демо

## Демо-модулі

| Модуль | Опис |
|--------|------|
| **Landing Labs** | B2B лендинг для AI automation lab — i18n (EN/UK), теми, статика HTML/CSS/JS, пререндер |
| **OpsHub** | Операційний хаб для оркестрації парку демо |
| **RAG Demo** | Демо RAG — запити до документів через AI |
| **PDF Report** | Автоматизована генерація PDF-звітів |
| **STT-LLM** | Розпізнавання мовлення + обробка LLM |
| **Speech Translate** | Локальна транскрибація whisper.cpp + хмарний переклад (специфікація MVP) |

## Стек

- **Лендинг:** Чистий HTML/CSS/JS, нуль залежностей, nginx статика
- **Бекенд:** Python, FastAPI-контракти
- **AI:** whisper.cpp, ONNX, LLM API (DeepSeek, opencode)
- **Інфраструктура:** Netcup VPS, Docker, Traefik, systemd

## Документація

- [Специфікація лендингу](Landing_Labs_fin_v.1.md) — архітектура, i18n, деплой
- [Промпт OpsHub](ПРОМПТ_OPSHUB_v1.md)
- [Промпт RAG демо](ПРОМПТ_RAG_ДЕМО_v1.1.md)
- [Специфікація Speech Translate MVP](speech_translate/SPEC_speech_local_MVP.md)
- [Порівняння VPS Netcup](VPS_Netcup.md)
