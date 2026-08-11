# DEPLOY — labs.mnemostroma.com

Целевой хост: **Netcup VPS 1000 G12** (4 vCore, 8 GB RAM, Ubuntu 24.04), Docker + Traefik standalone —
та же машина, где живут OpsHub и демо-контейнеры.

---

## 1. Раскладка файлов

```
/srv/site/
  public/            ← содержимое этого пакета
    index.html
    uk/index.html    ← генерируется build/prerender.py
    assets/{css,js,fonts,icons}
    i18n/{en,uk}.json
    robots.txt  sitemap.xml  site.webmanifest
  build/prerender.py
```

Сборка перед деплоем:

```bash
python3 build/prerender.py       # пересобрать /uk/ после любой правки index.html или uk.json
```

---

## 2. Контейнер статики

Статику отдаёт лёгкий nginx (≈8 MB RAM), а не бэкенд — чтобы падение API не роняло сайт.

```yaml
# /srv/site/docker-compose.yml
services:
  site:
    image: nginx:1.27-alpine
    container_name: site
    restart: unless-stopped
    mem_limit: 64m
    volumes:
      - ./public:/usr/share/nginx/html:ro
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    networks: [web]
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.site.rule=Host(`labs.mnemostroma.com`)"
      - "traefik.http.routers.site.entrypoints=websecure"
      - "traefik.http.routers.site.tls.certresolver=le"
      - "traefik.http.routers.site.middlewares=sec-headers@file,site-ratelimit@file"
      - "traefik.http.services.site.loadbalancer.server.port=80"

  site-api:
    build: ../site-api
    container_name: site-api
    restart: unless-stopped
    mem_limit: 256m
    env_file: .env               # OPSHUB_KEY, SMTP_*, TURNSTILE_SECRET, IP_HASH_SALT
    networks: [web, opsnet]      # opsnet — чтобы ходить в OpsHub внутренним именем
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.api.rule=Host(`labs.mnemostroma.com`) && PathPrefix(`/api/`)"
      - "traefik.http.routers.api.entrypoints=websecure"
      - "traefik.http.routers.api.tls.certresolver=le"
      - "traefik.http.routers.api.priority=10"     # выше, чем у site
      - "traefik.http.routers.api.middlewares=sec-headers@file,api-ratelimit@file"
      - "traefik.http.services.api.loadbalancer.server.port=8000"

networks:
  web: { external: true }
  opsnet: { external: true }
```

---

## 3. nginx.conf

```nginx
server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;

  gzip on;
  gzip_types text/css application/javascript application/json image/svg+xml;
  gzip_min_length 512;
  # если есть возможность — предсжать в brotli на сборке и включить brotli_static

  # Иммутабельная статика
  location ~* \.(woff2|css|js|svg|png|webp)$ {
    expires 30d;
    add_header Cache-Control "public, immutable";
  }
  # Словари меняются чаще — короткий кэш с ревалидацией
  location /i18n/ {
    expires 10m;
    add_header Cache-Control "public, must-revalidate";
  }
  location = /index.html { add_header Cache-Control "no-cache"; }
  location = /uk/       { try_files /uk/index.html =404; add_header Cache-Control "no-cache"; }

  location / { try_files $uri $uri/ /index.html; }

  # Скрыть служебное
  location ~ /\.(git|env) { return 404; }
}
```

---

## 4. Заголовки безопасности (Traefik file-provider)

Полный файл middleware живёт в репозитории: `infra/traefik/dynamic/middlewares.yml` (деплой — в `/srv/traefik/dynamic/middlewares.yml`). Там же `noindex` и `demo-ratelimit` для демо-поддоменов.

**Важно:** CSP без `'unsafe-inline'` в `script-src` работает только потому, что в разметке нет ни одного
inline-обработчика, а тема инициализируется отдельным файлом `theme-init.js`. Если добавите inline-скрипт —
либо вынесите в файл, либо считайте его SHA-256 и добавьте в CSP. Не добавлять `'unsafe-inline'`.

Аналитику (Plausible/Umami self-hosted) при подключении добавлять в `script-src` и `connect-src` **поимённо**,
не через `*`.

---

## 5. Шрифты

**Статус: шрифты уже закоммичены в репо** (`landing/assets/fonts/*.woff2`, коммит `e60a85e`) — отдельно скачивать не нужно, папка входит в пакет.

| Файл | Шрифт | Лицензия | Роль |
|:--|:--|:--|:--|
| `Archivo-Variable.woff2` | Archivo (variable, есть ось ширины) | OFL | заголовки, кнопки, бренд |
| `Inter-Variable.woff2` | Inter (variable) | OFL | основной текст |
| `JetBrainsMono-Variable.woff2` | JetBrains Mono (variable) | OFL | подписи, состояния, JSON |

Порядок действий при **пересборке** (например, смена версии шрифта):

1. Скачать variable-версии с Google Fonts / GitHub проектов.
2. **Сабсеттинг обязателен** — латиница + кириллица + украинские ґєії:
   ```bash
   pip install fonttools brotli
   pyftsubset Archivo[wdth,wght].ttf --flavor=woff2 --layout-features='*' \
     --unicodes="U+0000-00FF,U+0100-017F,U+0400-045F,U+0490-0491,U+2000-206F,U+2190-21BB,U+2212" \
     --output-file=Archivo-Variable.woff2
   ```
   Результат — обычно 30–60 KB на шрифт вместо 200+ KB.
3. Не подключать Google Fonts по CDN: это третья сторона в CSP, лишний RTT и вопрос по GDPR.
4. Если файлов нет — сайт не ломается: в CSS прописан системный fallback-стек.

**Источники исходников** (архивы лежат в `backups/фонты-шрифты/`, не в git): `Inter-4.1.zip` (→ `web/InterVariable.woff2`), `Archivo-VariableFont_wdth,wght.ttf`, `JetBrainsMono[wght].ttf`.

## 5.1. ONNX-модели RAG (не в git)

`backend/rag-demo` использует 3 ONNX-модели (`multilingual-e5-small`, `distilbert-ner`, `tinybert-rerank`). **В репо не коммитятся** — тянутся при сборке образа:

```bash
MODELS_DIR=/models python backend/rag-demo/scripts_download_models.py
```

Источник — HuggingFace (`Xenova/*`). Без шага запуска скрипта RAG-демо не поднимется (`/health` → `models_loaded=false`).

---

## 6. SEO / GEO

* `sitemap.xml` — проставлять `lastmod` в деплой-скрипте:
  ```bash
  sed -i "s|<lastmod>.*</lastmod>|<lastmod>$(date +%F)</lastmod>|g" public/sitemap.xml
  ```
* `hreflang` уже проставлен: `en` → `/`, `uk` → `/uk/`, `x-default` → `/`.
* Canonical у `/uk/` подменяется пререндером — проверить после сборки.
* Google Search Console + Bing Webmaster: подтвердить домен DNS-записью (не HTML-файлом — файл придётся
  исключать из CSP/robots).
* `og:image` — сгенерировать `public/assets/og-cover.png` 1200×630 (описание placeholder-а лежит в `index.html`).
* GEO-мета (`geo.region`) — слабый сигнал; реальную геопривязку даёт язык страницы, контакты и упоминание
  рынков в тексте. Если основной рынок не Украина — поправить `geo.*` и `areaServed` в JSON-LD.

---

## 7. Чеклист перед публикацией

- [ ] `python3 build/prerender.py` выполнен, `/uk/index.html` актуален
- [ ] Шрифты положены и просабсечены (или осознанно оставлен системный стек)
- [ ] `og-cover.png` и favicon созданы
- [ ] Реальные ссылки подставлены вместо `data-href-todo` (grep по проекту)
- [ ] Иконки заменены на SVG из локальной коллекции (`docs/ICONS.md`)
- [ ] MX/SPF/DKIM/DMARC для `contact@labs.mnemostroma.com` настроены
- [ ] `GET /api/v1/consult/...` и `POST /api/v1/consult` отвечают, письмо приходит
- [ ] CSP не выдаёт ошибок в консоли браузера
- [ ] Lighthouse: Performance ≥ 90, Accessibility ≥ 95 на мобильном профиле
- [ ] Проверено в тёмной и светлой теме, на 375 / 820 / 1440 px
