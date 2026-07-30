"""Тесты конфигурации: LANGS в app.js, маппинг в theme-init.js, hreflang в index.html.

Расширение: при добавлении языка обнови LANGS в conftest.py."""

import re
from conftest import LANGS, LOCALIZED, LANDING


def get_app_js():
    return (LANDING / "assets" / "js" / "app.js").read_text("utf-8")


def get_theme_init():
    return (LANDING / "assets" / "js" / "theme-init.js").read_text("utf-8")


def get_index_html():
    return (LANDING / "index.html").read_text("utf-8")


def test_app_js_langs():
    """"app.js `LANGS` содержит все коды из конфига (порядок: en + остальные по алфавиту)."""
    src = get_app_js()
    expected = ["en"] + sorted(l for l in LANGS if l != "en")
    m = re.search(r"const LANGS = \[([^\]]+)\]", src)
    assert m, "LANGS не найдено в app.js"
    actual = [x.strip().strip("'\"") for x in m.group(1).split(",")]
    assert set(actual) == set(expected), f"app.js LANGS={actual} != {expected}"
    # en должен быть первым
    assert actual[0] == "en", f"app.js: en должен быть первым, а не {actual[0]}"


def test_theme_init_mapping():
    """"theme-init.js маппит каждый язык (и be→uk)."""
    src = get_theme_init()
    for lang in LOCALIZED:
        assert f"lang = '{lang}'" in src or f"lang = c" in src, (
            f"theme-init.js не обрабатывает {lang}"
        )
    assert "be'" in src, "theme-init.js: be→uk fallback удалён"


def test_theme_init_no_unexpected_langs():
    """"theme-init.js не маппит коды, не указанные в LANGS (кроме be)."""
    src = get_theme_init()
    known = set(LANGS) | {"be", "en"}
    # ищем все if (c === '...') условия
    found = re.findall(r"c\s*===\s*'([^']+)'", src)
    for code in found:
        assert code in known, f"theme-init.js обрабатывает неизвестный код '{code}'"


def test_hreflang_alternates():
    """"index.html содержит hreflang для каждого языка."""
    html = get_index_html()
    for lang in LANGS:
        href = f"https://labs.mnemostroma.com/{lang}/" if lang != "en" else "https://labs.mnemostroma.com/"
        assert f'hreflang="{lang}"' in html, f"hreflang {lang} отсутствует в index.html"


def test_jsonld_languages():
    """"JSON-LD availableLanguage содержит все языки."""
    html = get_index_html()
    expected = sorted(LANGS)
    m = re.search(r'"availableLanguage":\s*\[([^\]]+)\]', html)
    assert m, "availableLanguage не найдено в JSON-LD"
    actual = sorted(x.strip().strip('"') for x in m.group(1).split(","))
    assert actual == expected, f"JSON-LD availableLanguage={actual} != {expected}"
