# ICONS — замена плейсхолдеров на SVG

> **Статус: готово.** Все 31 иконка встроена как inline-SVG в `index.html`, `ru/`, `uk/`, `pl/`
> (по 32 svg на версию; `sun-moon` — композит из двух глифов, переключается по `data-theme`).
> Источники: `assets/icons/*.svg` (Phosphor light/thin, `fill="currentColor"`, viewBox `0 0 256 256`).
> CSS-правила для `svg.ico` добавлены в `assets/css/style.css`.

## Как устроен плейсхолдер (было)

```html
<span class="ico ico--lg" data-icon="shield-check" data-tone="accent"
      title="Иконка: щит с галочкой. Цвет: акцент. Смысл: подтверждение человеком."></span>
```

* `data-icon` — имя иконки (искать в коллекции по этому слову);
* `data-tone` — цвет: `accent` (акцентный, оранжевый/сливовый по теме), `text`, `muted`;
* `title` — что должна означать иконка;
* размер: базовый 2.4rem, `ico--sm` 1.55rem, `ico--lg` 3rem, `ico--brand` 2rem.

## Как заменить (выполнено)

Заглушки `<span class="ico" data-icon="…">` заменены на inline-SVG с сохранением класса и tone:

```html
<svg class="ico ico--sm" data-tone="muted" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
  <path d="…"/>
</svg>
```

Три обязательных условия соблюдены:

1. `stroke="currentColor"` / `fill="currentColor"` — иначе иконка не перекрасится при смене темы;
2. убрать из SVG жёстко зашитые `fill="#000"`, `<style>` и `class` из редактора;
3. `aria-hidden="true"`, если рядом есть текст; `role="img" + <title>`, если иконка одна и несёт смысл.

После замены убрать у `.ico` `::after` не нужно — оно больше не применяется (нет `<span>` без содержимого);
для `<svg class="ico">` border убран через дополнительное правило, добавленное в конец `.ico`-блока:

```css
svg.ico{border:0;padding:0;width:auto;height:2.4rem}
svg.ico--sm{height:1.55rem}
svg.ico--lg{height:3rem}
```

## Полный список используемых иконок

| `data-icon` | Где | Тон | Смысл |
|:--|:--|:--|:--|
| `hexagon-nodes` | логотип в шапке | accent | связанные модули, не один бот |
| `sun-moon` | переключатель темы (шапка, футер) | muted | смена темы |
| `menu-2` | бургер | text | мобильное меню |
| `hand-stop` | hero, факт 1 | accent | человек останавливает процесс |
| `quote-source` | hero, факт 2 | accent | ответ с цитатой источника |
| `server-lock` | hero, факт 3 | accent | self-hosted, данные под замком |
| `signature` | gate в runner | accent | точка подписи человека |
| `file-stack` | проблема 1 | accent | ручной разбор документов |
| `inbox-arrow` | проблема 2 | accent | разбор входящих |
| `search-book` | проблема 3 | accent | поиск правила в базе знаний |
| `report-clock` | проблема 4 | accent | ручная сборка отчётов |
| `route-split` | демо: диспетчер | accent | маршрутизация заявок |
| `scan-doc` | демо: извлечение | accent | OCR документа |
| `library-search` | демо: RAG | accent | поиск по знаниям с цитатой |
| `file-export` | демо: PDF/КП | accent | генерация документа |
| `user-flow` | демо: CRM | accent | следующий шаг сделки |
| `chart-anomaly` | демо: аналитик | accent | аномалия в данных |
| `shield-check` | контроль 1 | accent | подтверждение перед действием |
| `fingerprint-doc` | контроль 2 | accent | прослеживаемость |
| `mask-eye` | контроль 3 | accent | маскирование данных |
| `key-rotate` | контроль 4 | accent | BYOK, ротация ключа |
| `container` | стек | muted | Docker |
| `python` | стек | muted | Python/FastAPI |
| `database` | стек | muted | PostgreSQL |
| `vector-dots` | стек | muted | векторное хранилище |
| `text-scan` | стек | muted | OCR |
| `router` | стек | muted | Traefik |
| `swap` | стек | muted | сменный провайдер модели |
| `plug` | стек | muted | API / MCP |
| `github` | футер | muted | GitHub |
| `telegram` | футер | muted | Telegram |

Итого **31** иконка. Стиль коллекции (минималистичный outline) подходит: в макете иконки идут тонкой линией
на 1.5–1.6 px при 24×24, без заливок.

## Плейсхолдеры изображений

Три штриховых блока `.ph` с описанием в `.ph__t`:

1. Скриншот сквозного pipeline (секция «Pipeline»), 1200×620.
2. Схема слоёв данных и адаптера моделей (секция «Stack»), 1200×560.
3. `og-cover.png` 1200×630 — описан комментарием в `<head>` `index.html`.

Найти все: `grep -rn "PLACEHOLDER\|ph__t" index.html`.
