# Project Rules

## Virtual Environment

При необходимости создания виртуального окружения Python — использовать `uv`, а не `venv`:

```bash
uv venv
source .venv/bin/activate
uv pip install <package>
```

## Language code convention

`uk` (ISO 639-1 for Ukrainian) — только внутри кода: url paths (`/uk/`), i18n filenames (`uk.json`), JS constants (`uk`), hreflang, HTML `lang="uk"`.

На фронтенде лендинга (кнопки переключателя языков, упоминания в тексте) — **UA**. Пример: кнопка `UA` в `seg__b`, описание `i18n (EN/UK/PL/RU)` в README. Правило: код → `uk`, пользователь → `UA`.
