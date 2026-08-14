#!/usr/bin/env python3
"""
prerender.py — генерирует /uk/index.html из index.html + i18n/uk.json.

Зачем: тексты подгружаются JSON-ом на лету, но поисковику и AI-краулеру
нужен готовый текст в HTML. Поэтому:
  /      — англ. версия, текст зашит в разметке
  /uk/   — укр. версия, текст подставлен на этапе сборки
JSON-словари продолжают работать для мгновенного переключения языка в браузере.

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

LANGS = ["uk"]
DOMAIN = "agentmesh-labs.mnemostroma.com"

SUBPAGES = ["architecture", "security", "licensing", "docs", "demo", "privacy", "terms"]


def deep_get(d, dotted):
    # Словари здесь плоские ("caps.c1.title" — один ключ), но поддерживаем
    # и вложенную структуру на случай миграции.
    if dotted in d:
        return d[dotted]
    cur = d
    for part in dotted.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur if isinstance(cur, str) else None


def process_page(lang, src_path, out_path, base_url):
    dict_path = ROOT / "i18n" / f"{lang}.json"

    if not src_path.exists() or not dict_path.exists():
        print(f"ПРОПУСК: {src_path} или i18n/{lang}.json не найдены", file=sys.stderr)
        return False

    src = src_path.read_text(encoding="utf-8")
    d = json.loads(dict_path.read_text(encoding="utf-8"))
    missing = []

    # 1) текстовые узлы: <tag data-i18n="key">старый текст</tag>
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

    # 2) атрибуты: data-i18n-attr="attr=key,attr2=key2"
    def repl_attr(m):
        tag = m.group(0)
        spec = m.group(1)
        for pair in spec.split(","):
            if "=" not in pair:
                continue
            attr, key = (p.strip() for p in pair.split("=", 1))
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

    # 3) <title> — для подстраниц берём meta.title.<slug>, для главной meta.title
    title = None
    if src_path.parent.name != "agentmesh-landing" and src_path.parent.name != ROOT.name:
        # src_path = ROOT/<slug>/index.html
        title = deep_get(d, f"meta.title.{src_path.parent.name}")
    if title is None:
        title = deep_get(d, "meta.title")
    if title:
        src = re.sub(
            r"(<title[^>]*>).*?(</title>)",
            lambda m: m.group(1) + html.escape(title, quote=False) + m.group(2),
            src,
            flags=re.S,
        )
        src = re.sub(
            r'(<meta property="og:title" content=")[^"]*(")',
            lambda m: m.group(1) + html.escape(title, quote=True) + m.group(2),
            src,
            count=1,
        )

    # 4) язык документа, canonical, og:url, data-lang-default
    src = src.replace('<html lang="en"', f'<html lang="{lang}"', 1)
    src = src.replace(
        f'<link rel="canonical" href="https://{DOMAIN}/{base_url}">',
        f'<link rel="canonical" href="https://{DOMAIN}/{lang}/{base_url}">',
        1,
    )
    src = src.replace(
        f'<meta property="og:url" content="https://{DOMAIN}/{base_url}">',
        f'<meta property="og:url" content="https://{DOMAIN}/{lang}/{base_url}">',
        1,
    )
    src = src.replace(
        'data-theme="dark"',
        f'data-theme="dark" data-lang-default="{lang}"',
        1,
    )

    out_path.parent.mkdir(exist_ok=True)
    out_path.write_text(src, encoding="utf-8")

    uniq = sorted(set(k for k in missing if k))
    print(f"OK: {out_path.relative_to(ROOT)} собран")
    if uniq:
        print(f"  ВНИМАНИЕ: нет перевода для {len(uniq)} ключей: {', '.join(uniq[:15])}")
    return True


def main() -> int:
    ok = 0
    total = 0
    for lang in LANGS:
        # главная
        total += 1
        if process_page(lang, ROOT / "index.html", ROOT / lang / "index.html", ""):
            ok += 1
        # подстраницы
        for slug in SUBPAGES:
            total += 1
            if process_page(lang, ROOT / slug / "index.html", ROOT / lang / slug / "index.html", f"{slug}/"):
                ok += 1
    print(f"\nГотово: {ok}/{total} страниц")
    return 0 if ok == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
