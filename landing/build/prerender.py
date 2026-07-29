#!/usr/bin/env python3
"""
prerender.py — генерирует /uk/index.html из index.html + i18n/uk.json.

Зачем: тексты подгружаются JSON-ом на лету (требование «всё грузится отдельно»),
но поисковику и AI-краулеру нужен готовый текст в HTML. Поэтому:
  /          — англ. версия, текст зашит в разметке
  /uk/       — укр. версия, текст подставлен на этапе сборки
JSON-словари при этом продолжают работать для мгновенного переключения языка в браузере.

Запуск:  python3 build/prerender.py
Зависимости: только стандартная библиотека.
"""

import html
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "index.html"
DICT = ROOT / "i18n" / "uk.json"
OUT_DIR = ROOT / "uk"
OUT = OUT_DIR / "index.html"

LANG = "uk"


def deep_get(d, dotted):
    cur = d
    for part in dotted.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur if isinstance(cur, str) else None


def main() -> int:
    if not SRC.exists() or not DICT.exists():
        print("index.html или i18n/uk.json не найдены", file=sys.stderr)
        return 1

    src = SRC.read_text(encoding="utf-8")
    d = json.loads(DICT.read_text(encoding="utf-8"))
    missing = []

    # 1) текстовые узлы: <tag data-i18n="key">старый текст</tag>
    #    группы: 1=открывающий тег, 2=имя тега, 3=ключ, 4=старый текст, 5=закрывающий тег
    def repl_text(m):
        head, key, close = m.group(1), m.group(3), m.group(5)
        val = deep_get(d, key)
        if val is None:
            missing.append(key)
            return m.group(0)
        return f"{head}{html.escape(val, quote=False)}{close}"

    src = re.sub(
        r'(<([a-zA-Z0-9]+)[^>]*\bdata-i18n="([^"]+)"[^>]*>)(.*?)(</\2>)',
        repl_text,
        src,
        flags=re.S,
    )

    # 2) атрибуты: data-i18n-attr="content:meta.title;placeholder:form.x"
    def repl_attr(m):
        tag = m.group(0)
        spec = m.group(1)
        for pair in spec.split(";"):
            if ":" not in pair:
                continue
            attr, key = (p.strip() for p in pair.split(":", 1))
            val = deep_get(d, key)
            if val is None:
                missing.append(key)
                continue
            esc = html.escape(val, quote=True)
            if re.search(rf'\b{re.escape(attr)}="[^"]*"', tag):
                tag = re.sub(rf'\b{re.escape(attr)}="[^"]*"', f'{attr}="{esc}"', tag, count=1)
            else:
                tag = tag[:-1] + f' {attr}="{esc}">'
        return tag

    src = re.sub(r"<[^>]*\bdata-i18n-attr=\"([^\"]+)\"[^>]*>", repl_attr, src)

    # 3) <title>
    title = deep_get(d, "meta.title")
    if title:
        src = re.sub(r"(<title[^>]*>).*?(</title>)", lambda m: m.group(1) + html.escape(title, quote=False) + m.group(2), src, flags=re.S)

    # 4) язык документа, canonical, абсолютные пути ассетов остаются корневыми
    src = src.replace('<html lang="en"', f'<html lang="{LANG}"', 1)
    src = src.replace(
        '<link rel="canonical" href="https://labs.mnemostroma.com/">',
        '<link rel="canonical" href="https://labs.mnemostroma.com/uk/">',
        1,
    )
    src = src.replace(
        '<meta property="og:url" content="https://labs.mnemostroma.com/">',
        '<meta property="og:url" content="https://labs.mnemostroma.com/uk/">',
        1,
    )
    # чтобы app.js не переключал язык обратно
    src = src.replace('data-theme="dark"', 'data-theme="dark" data-lang-default="uk"', 1)

    OUT_DIR.mkdir(exist_ok=True)
    OUT.write_text(src, encoding="utf-8")

    uniq = sorted(set(k for k in missing if k))
    print(f"OK: {OUT.relative_to(ROOT)} собран")
    if uniq:
        print(f"ВНИМАНИЕ: нет перевода для {len(uniq)} ключей: {', '.join(uniq[:15])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
