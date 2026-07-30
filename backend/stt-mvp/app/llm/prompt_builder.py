"""System prompt assembly from the editable config file (hot reload, validation).

The config file is the ONLY source of the system prompt. The code never hardcodes
instruction text — toggling a section on/off or rewording it requires no deploy.
"""
from __future__ import annotations

import os
import threading
import time
from typing import Any

import yaml

CONFIG_PATH = os.environ.get("LLM_PROMPT_CONFIG", os.path.join(os.path.dirname(__file__), "..", "..", "config", "llm_prompt.yaml"))

# Sections in assembly order for live translate calls; summary_rules is appended
# only by the /summary endpoint.
LIVE_SECTIONS = ("core", "editor", "glossary", "register", "hints", "action_items", "question_flag")
REQUIRED_SECTIONS = ("core", "editor", "hints", "summary_rules")


class PromptConfigError(ValueError):
    pass


class PromptConfig:
    """Thread-safe config with mtime-based hot reload."""

    def __init__(self, path: str = CONFIG_PATH) -> None:
        self.path = os.path.abspath(path)
        self._lock = threading.Lock()
        self._data: dict[str, Any] = {}
        self._mtime = 0.0
        self.reload(force=True)

    # ---------- load / save ----------
    def reload(self, force: bool = False) -> None:
        try:
            mtime = os.path.getmtime(self.path)
        except OSError as e:
            raise PromptConfigError(f"prompt config not found: {self.path}") from e
        if not force and mtime == self._mtime:
            return
        with open(self.path, encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        self.validate(data)
        with self._lock:
            self._data = data
            self._mtime = mtime

    def raw(self) -> dict[str, Any]:
        self.reload()
        with self._lock:
            return dict(self._data)

    def save(self, data: dict[str, Any]) -> None:
        """PUT from UI: validate first, write atomically, then hot-reload."""
        self.validate(data)
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            yaml.safe_dump(data, f, allow_unicode=True, sort_keys=False)
        os.replace(tmp, self.path)
        self.reload(force=True)

    @staticmethod
    def validate(data: dict[str, Any]) -> None:
        if not isinstance(data, dict):
            raise PromptConfigError("config root must be a mapping")
        for name in REQUIRED_SECTIONS:
            sec = data.get(name)
            if not isinstance(sec, dict) or not str(sec.get("text", "")).strip():
                raise PromptConfigError(f"section '{name}' with non-empty 'text' is required")
        core = data["core"]
        for ph in ("{source_lang}", "{target_lang}"):
            if ph not in core["text"]:
                raise PromptConfigError(f"core.text must contain placeholder {ph}")

    # ---------- assembly ----------
    def _fill(self, text: str, vars_: dict[str, str]) -> str:
        out = text
        for k, v in vars_.items():
            out = out.replace("{" + k + "}", v)
        return out.strip()

    def _glossary_str(self) -> str:
        terms = (self.raw().get("glossary") or {}).get("terms") or {}
        return "\n".join(f'- "{k}" -> "{v}"' for k, v in terms.items())

    def enabled(self, section: str) -> bool:
        sec = self.raw().get(section) or {}
        if section == "core":
            return True  # core cannot be disabled
        return bool(sec.get("enabled"))

    def build_live_prompt(self, source_lang: str, target_lang: str, mode: str) -> str:
        data = self.raw()
        vars_ = {
            "source_lang": source_lang,
            "target_lang": target_lang,
            "mode": mode,
            "glossary": self._glossary_str(),
            "max_hints": str((data.get("hints") or {}).get("max_hints", 3)),
        }
        parts: list[str] = []
        for name in LIVE_SECTIONS:
            sec = data.get(name) or {}
            if name != "core" and not sec.get("enabled"):
                continue
            if name == "glossary" and not vars_["glossary"]:
                continue
            text = str(sec.get("text", "")).strip()
            if text:
                parts.append(self._fill(text, vars_))
        parts.append(self._response_schema(data))
        return "\n\n".join(parts)

    def build_summary_prompt(self, target_lang: str) -> str:
        data = self.raw()
        if not (data.get("summary_rules") or {}).get("enabled"):
            raise PromptConfigError("summary_rules section is disabled in the prompt config")
        text = self._fill(data["summary_rules"]["text"], {"target_lang": target_lang})
        return (
            text
            + "\n\nReturn STRICT JSON only, no markdown fences:\n"
            + '{"summary": "...", "key_moments": ["..."], "risks": ["..."]}'
        )

    def _response_schema(self, data: dict[str, Any]) -> str:
        """The JSON contract mirrors which sections are enabled."""
        fields = ['"translation": "..."', '"changes": [{"type": "...", "original": "...", "replacement": "..."}]']
        if (data.get("hints") or {}).get("enabled"):
            fields.append('"hints": ["..."]')
        if (data.get("action_items") or {}).get("enabled"):
            fields.append('"action_items": [{"who": "...", "what": "...", "due": "..."}]')
        if (data.get("question_flag") or {}).get("enabled"):
            fields.append('"is_question": false')
        return "Return STRICT JSON only, no markdown fences:\n{" + ", ".join(fields) + "}"


prompt_config = PromptConfig()
