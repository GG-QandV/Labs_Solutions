import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
LANDING = ROOT / "landing"
I18N_DIR = LANDING / "i18n"
BUILD_DIR = LANDING / "build"

# При добавлении нового языка добавь код в этот список
LANGS = ["en", "uk", "pl", "ru"]
LOCALIZED = [l for l in LANGS if l != "en"]


def load_json(name):
    return json.loads((I18N_DIR / name).read_text(encoding="utf-8"))


def flatten_keys(d, prefix=""):
    keys = set()
    for k, v in d.items():
        if isinstance(v, dict):
            keys.update(flatten_keys(v, f"{prefix}{k}."))
        else:
            keys.add(f"{prefix}{k}")
    return keys
