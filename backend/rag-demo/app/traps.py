"""Trap logs — единая точка фильтрации диагностики по TRAP_LOGS / TRAP_LEVEL.

Прод-режим (TRAP_LEVEL=warning): в OpsHub уходят только error/warning.
Info/debug включаются точечно через TRAP_LEVEL при отладке (аудит F8).
"""
from __future__ import annotations

import logging

from . import config

log = logging.getLogger("rag.traps")

_TRAP_RANK = {"error": 0, "warning": 1, "info": 2, "debug": 3}


def trap(level: str, msg: str, *args, **kw) -> None:
    """Пишет ловушку только если TRAP_LOGS=1 и level <= TRAP_LEVEL."""
    if not config.TRAP_LOGS:
        return
    if _TRAP_RANK.get(level, 1) > _TRAP_RANK.get(config.TRAP_LEVEL, 1):
        return
    getattr(log, level, log.info)(msg, *args, **kw)
