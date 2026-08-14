#!/usr/bin/env python3
"""
version-assets.py — версионирует локальные ассеты для обхода edge-кэша (CF).

Проблема: Cloudflare кэширует /assets/js|css на 30 дней (immutable).
index.html не кэшируется, поэтому после деплоя браузер получает свежую
разметку, но старые (закэшированные) JS/CSS. Версионирование меняет URL
(?v=<hash содержимого>) — новый URL = новый кэш-ключ.

Что делает:
  1. index.html (+ все подстраницы): src/href="/assets/..." -> "?v=<hash>"
  2. Внутренние ES-imports в /assets/js/*.js: from "./x.js" -> "./x.js?v=<hash>"
  3. /uk/index.html и prerender.js артефакты не трогает (пересобрать после).

Запуск:  python3 build/version-assets.py
Зависимости: только стандартная библиотека.
"""

import hashlib
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"

SKIP_HASH = {".woff2", ".png", ".webp"}  # имя файла-ревизия или генерится один раз


def file_hash(rel_path: pathlib.Path) -> str:
    return hashlib.sha256(rel_path.read_bytes()).hexdigest()[:10]


def assets_path_hash(url: str) -> str | None:
    """url вида /assets/<subpath>/<file>.<ext> — возвращает '?v=hash' или None."""
    m = re.match(r"^/assets/(.+)$", url)
    if not m:
        return None
    rel = pathlib.Path("assets") / m.group(1)
    if not (ROOT / rel).is_file():
        return None
    if rel.suffix in SKIP_HASH:
        return None
    return f"?v={file_hash(ROOT / rel)}"


def version_html(path: pathlib.Path) -> int:
    src = path.read_text(encoding="utf-8")
    changed = 0

    def repl(m):
        nonlocal changed
        attr, url = m.group(1), m.group(2)
        q = assets_path_hash(url)
        if q is None:
            return m.group(0)
        if "?" in url:
            return m.group(0)
        changed += 1
        return f'{attr}="{url}{q}"'

    new_src = re.sub(r'(src|href)="(/assets/[^"]+)"', repl, src)
    if new_src != src:
        path.write_text(new_src, encoding="utf-8")
    return changed


def version_js_imports(path: pathlib.Path) -> int:
    src = path.read_text(encoding="utf-8")
    changed = 0

    def repl(m):
        nonlocal changed
        spec = m.group(1)
        if not spec.startswith("./") or "?" in spec:
            return m.group(0)
        target = path.parent / spec
        if not target.is_file():
            return m.group(0)
        changed += 1
        return f'from "{spec}?v={file_hash(target)}"'

    new_src = re.sub(r'from "(\.[^"]+\.js)"', repl, src)
    if new_src != src:
        path.write_text(new_src, encoding="utf-8")
    return changed


def main() -> int:
    total = 0
    pages = [ROOT / "index.html"]
    for slug in ["architecture", "security", "licensing", "docs", "demo", "privacy", "terms"]:
        pages.extend(sorted((ROOT / slug).glob("index.html")))
    for html in pages:
        if html.exists():
            total += version_html(html)
    for js in sorted((ASSETS / "js").glob("*.js")):
        total += version_js_imports(js)
    print(f"OK: {total} URL ассетов версионировано")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
