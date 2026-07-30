"""Тесты сгенерированных prerender.py страниц.

Расширение: при добавлении языка обнови LANGS в conftest.py и перезапусти prerender."""

import re
from conftest import LOCALIZED, LANDING


def get_prerendered_html(lang):
    path = LANDING / lang / "index.html"
    assert path.exists(), f"Не найден {lang}/index.html — запусти build/prerender.py"
    return path.read_text("utf-8")


def _check_hreflang_all_present(html, lang):
    """Проверяет наличие hreflang для всех языков."""
    for l in [lang, *[x for x in ["en", "uk", "pl", "ru", "x-default"] if x != lang]]:
        assert f'hreflang="{l}"' in html, (
            f"hreflang={l} отсутствует в {lang}/index.html"
        )


def test_prerendered_lang_attribute():
    """Сгенерированная страница имеет правильный lang=."""
    for lang in LOCALIZED:
        html = get_prerendered_html(lang)
        assert f'<html lang="{lang}"' in html, (
            f"{lang}/index.html: lang != {lang}"
        )


def test_prerendered_lang_default():
    """Сгенерированная страница имеет data-lang-default."""
    for lang in LOCALIZED:
        html = get_prerendered_html(lang)
        assert f'data-lang-default="{lang}"' in html, (
            f"{lang}/index.html: data-lang-default != {lang}"
        )


def test_prerendered_canonical():
    """Сгенерированная страница имеет правильный canonical."""
    for lang in LOCALIZED:
        html = get_prerendered_html(lang)
        assert f'href="https://labs.mnemostroma.com/{lang}/"' in html, (
            f"{lang}/index.html: canonical url ошибочен"
        )


def test_prerendered_og_url():
    """Сгенерированная страница имеет правильный og:url."""
    for lang in LOCALIZED:
        html = get_prerendered_html(lang)
        assert f'og:url" content="https://labs.mnemostroma.com/{lang}/"' in html, (
            f"{lang}/index.html: og:url ошибочен"
        )


def test_prerendered_hreflang():
    """Сгенерированная страница содержит hreflang для всех языков."""
    for lang in LOCALIZED:
        html = get_prerendered_html(lang)
        _check_hreflang_all_present(html, lang)


def test_prerendered_text_replaced():
    """Текст в сгенерированной странице заменён (не содержит английских fallback-ов в видимом тексте).
    data-i18n атрибуты остаются для клиентского переключения — это нормально."""
    for lang in LOCALIZED:
        html = get_prerendered_html(lang)
        # Проверяем, что английские фразы из en.json заменены
        eng_patterns = ["live AI automation", "Working AI", "Run it yourself", "Not a chat"]
        for pat in eng_patterns:
            body = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.S)
            body = re.sub(r"<[^>]+>", " ", body)
            assert pat.lower() not in body.lower(), (
                f"{lang}/index.html: содержит английский текст: {pat!r}"
            )


def test_no_english_title_in_prerendered():
    """Заголовок сгенерированной страницы не английский."""
    for lang in LOCALIZED:
        html = get_prerendered_html(lang)
        # title может быть <title>текст</title> или <title data-i18n="...">текст</title>
        title = re.search(r"<title[^>]*>(.*?)</title>", html)
        assert title, f"{lang}/index.html: <title> не найден"
        eng_patterns = ["live AI automation", "you can run"]
        for pat in eng_patterns:
            assert pat.lower() not in title.group(1).lower(), (
                f"{lang}/index.html: title содержит английский текст: {title.group(1)!r}"
            )
