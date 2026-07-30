"""Тесты i18n: полнота ключей, отсутствие лишних, соответствие коду.

Расширение: при добавлении DE/NL просто добавь код в conftest.LANGS."""

import pytest
from conftest import I18N_DIR, LANGS, LOCALIZED, load_json, flatten_keys


@pytest.fixture(scope="session")
def en_keys():
    return flatten_keys(load_json("en.json"))


@pytest.mark.parametrize("lang", LOCALIZED)
def test_all_keys_present(en_keys, lang):
    """Каждый язык содержит все ключи из en.json."""
    keys = flatten_keys(load_json(f"{lang}.json"))
    missing = en_keys - keys
    assert not missing, f"{lang}: пропущены ключи: {missing}"


@pytest.mark.parametrize("lang", LOCALIZED)
def test_no_extra_keys(en_keys, lang):
    """Ни один язык не содержит ключей, которых нет в en.json."""
    keys = flatten_keys(load_json(f"{lang}.json"))
    extra = keys - en_keys
    assert not extra, f"{lang}: лишние ключи: {extra}"


def test_all_expected_files_exist():
    """Для каждого языка есть JSON-файл словаря."""
    for lang in LANGS:
        path = I18N_DIR / f"{lang}.json"
        assert path.exists(), f"Отсутствует i18n/{lang}.json"


def test_no_orphan_files():
    """Нет JSON-файлов словарей, не указанных в LANGS."""
    actual = {f.stem for f in I18N_DIR.glob("*.json") if f.stem != "en"}
    expected = set(LOCALIZED)
    assert actual == expected, f"Неожиданные файлы: {actual - expected}"


@pytest.mark.parametrize("lang", LOCALIZED)
def test_values_are_strings(lang):
    """Все значения-листья являются строками (не числа, не null)."""
    d = load_json(f"{lang}.json")

    def check(obj, path=""):
        for k, v in obj.items():
            p = f"{path}.{k}" if path else k
            if isinstance(v, dict):
                check(v, p)
            else:
                assert isinstance(v, str), f"{lang}: {p!r} — не строка ({type(v).__name__})"
    check(d)


def test_key_count_consistency():
    """Все языки имеют одинаковое количество конечных ключей."""
    ref = len(flatten_keys(load_json("en.json")))
    for lang in LOCALIZED:
        assert len(flatten_keys(load_json(f"{lang}.json"))) == ref, (
            f"{lang}: количество ключей ({len(flatten_keys(load_json(f'{lang}.json')))}) "
            f"не совпадает с en ({ref})"
        )
