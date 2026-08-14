# AgentMesh Labs — frontend (agentmesh-labs.mnemostroma.com)

Продуктовый лендинг + live-sandbox wizard для AgentMesh Labs: ACP ↔ A2A агенты через один gateway, изолированные сессии, временные credentials, синхронные диалоги и асинхронные задачи.

## Стек

- Vanilla HTML/CSS/JS (ES modules), без сборки и зависимостей.
- Дизайн-токены: `assets/css/tokens.css` (dark по умолчанию + light).
- Логотип Labs.Mnemostroma — inline SVG с запечёнными путями из брендбука; цвета частей переключаются по теме через `[data-logo-part]` (см. `components.css`).
- Шрифты: `Inter Tight` (fallback Inter), `JetBrains Mono` — `assets/fonts/`.

## Структура

```
index.html            — лендинг (все секции) + разметка wizard modal
robots.txt            — индексация: контент да, API/сессии нет
sitemap.xml           — только / и /uk/ (подстраницы — следующим заходом)
assets/
  css/  tokens base layout components demo print
  js/   theme-init theme i18n api-client session-store sse-client
        modal clipboard connection-map status-timeline hermes-panel
        report-panel demo-wizard app
  fonts/  Inter-Variable.woff2  JetBrainsMono-Variable.woff2
  icons/  favicon.svg
i18n/   en.json  uk.json   (ключ localStorage: aml-lang, default en)
```

Подпапки `architecture/ security/ licensing/ docs/ demo/ privacy/ terms/ build/` — заглушки для будущих SEO-страниц и `build/prerender.py`.

## Запуск локально

```bash
python3 -m http.server 8080
# → http://localhost:8080
```

## Режимы wizard

- **Live**: `api-client.js` сначала честно пробует `GET /api/v1/agentmesh/availability` (таймаут 2.5s, AbortController). Если backend ответил — реальная сессия через EventSource (`/api/v1/agentmesh/...`).
- **Mock (default, пока нет agentmesh-api)**: детерминированный симулятор. В UI явно помечен: pill `SIMULATED` + footer «Sandbox preview — backend not reachable, deterministic mock».
- Переопределение: `?mock=1|0` или `window.AML_API_BASE` (задать в консоли до `app.js`).

Mock-таймлайн: `created → agent_card_validating(+700ms) → discovered(+800) → capability_checked(+900) → task_running(+1600) → verified`. Отмена — через флаг `_cancelled` в `api-client.js`.

## i18n

- Языки: `en`, `uk` (`uk` в коде / `UA` в UI, см. CLAUDE.md).
- Паттерны: `data-i18n`, `data-i18n-attr="placeholder=key"`, `data-i18n-html`.
- Ключ переключения: `aml-lang`. English — prerendered в HTML (SEO).

## Тема

- Ключ `aml-theme` (`dark`/`light`), событие `aml:themechange`.
- `theme-init.js` — pre-paint скрипт (до CSS) против FOUC, подключается первым в `<head>`.

## Конвенции

- Тёмная тема — дефолт, атрибут `data-theme` на `<html>`.
- Никаких UI-утечек: raw Bearer не показывается после первого копирования, нет internal hostnames, raw логов/стектрейсов/полных payload-ов, нет фейковых typing-анимаций (спека §11).
- `role_relevant` — эвристический non-blocking сигнал, не блокирует вердикт.

## Deploy

Продакшн: статика → `/srv/site/public` (nginx); `/api/v1/agentmesh/*` и `/agents/*` → gatewayd `172.18.0.1:8348` (Traefik). Детали — в `../backend/gateway/traefik-dynamic.yml`.

## TODO / техдолг

- [ ] SEO-подстраницы: `/architecture/ /security/ /licensing/ /docs/ /demo/ /privacy/ /terms/` (папки созданы).
- [ ] `build/prerender.py` (по образцу `../landing/build/prerender.py`).
- [ ] Подключение реального agentmesh-api backend.
- [ ] `assets/og/og-cover.png` — og-изображение (пока 404).
