"""Тесты trap()-фильтрации (аудит F8): TRAP_LOGS / TRAP_LEVEL."""
import importlib
import io
import logging

import pytest

from app import config
from app import traps


@pytest.fixture()
def trap_buf():
    """Перехватываем вывод логгера traps."""
    buf = io.StringIO()
    handler = logging.StreamHandler(buf)
    traps.log.handlers.clear()
    traps.log.addHandler(handler)
    traps.log.setLevel(logging.DEBUG)
    return buf


def _reload_with(**env):
    import app.config as cfg

    for k, v in env.items():
        cfg.__dict__.pop(k, None)
        __import__("os").environ[k] = v
    importlib.reload(cfg)
    importlib.reload(traps)
    return cfg


def test_warning_level_hides_info(trap_buf):
    _reload_with(TRAP_LOGS="1", TRAP_LEVEL="warning")
    traps.trap("info", "diag-info")
    traps.trap("warning", "warn-msg")
    traps.trap("error", "err-msg")
    out = trap_buf.getvalue()
    assert "diag-info" not in out
    assert "warn-msg" in out
    assert "err-msg" in out


def test_error_level_hides_warning(trap_buf):
    _reload_with(TRAP_LOGS="1", TRAP_LEVEL="error")
    traps.trap("warning", "warn-hidden")
    traps.trap("error", "err-shown")
    out = trap_buf.getvalue()
    assert "warn-hidden" not in out
    assert "err-shown" in out


def test_info_level_shows_info_but_not_debug(trap_buf):
    _reload_with(TRAP_LOGS="1", TRAP_LEVEL="info")
    traps.trap("info", "info-shown")
    traps.trap("debug", "debug-hidden")
    out = trap_buf.getvalue()
    assert "info-shown" in out
    assert "debug-hidden" not in out  # info-уровень НЕ включает debug (rank info=2 < debug=3)


def test_debug_level_shows_all(trap_buf):
    _reload_with(TRAP_LOGS="1", TRAP_LEVEL="debug")
    traps.trap("debug", "debug-shown")
    out = trap_buf.getvalue()
    assert "debug-shown" in out


def test_trap_logs_zero_silences_everything(trap_buf):
    _reload_with(TRAP_LOGS="0", TRAP_LEVEL="error")
    traps.trap("error", "silent-err")
    assert "silent-err" not in trap_buf.getvalue()
