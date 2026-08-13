"""Сценарий демо: события SSE с серверными паузами.

Укладывается в семишаговый трек лендинга (SPEC §2):
  01 Received → 02 Extracted → 03 Verified → 04 Matched → 05 Drafted
  → 06 Awaiting approval → 07 Sent

Ключевое для доверия: агенты A и B работают независимо и не знают друг о друге —
это проговаривается в комментариях, иначе зритель заподозрит подыгрывание.
"""
from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator

from . import config
from .extract import CLAUSES, Clause, extract_live, extract_offline, load_doc
from .i18n import t

Event = dict


def _pause(sec: float) -> float:
    return sec / max(config.SPEED, 0.05)


def compare(a: list[Clause], b: list[Clause]) -> list[dict]:
    ai = {c.key: c for c in a}
    bi = {c.key: c for c in b}
    rows = []
    for k in CLAUSES:
        ca, cb = ai.get(k), bi.get(k)
        rows.append({
            "key": k,
            "a": ca.value if ca else "",
            "b": cb.value if cb else "",
            "a_source": ca.source if ca else "",
            "b_source": cb.source if cb else "",
            "match": bool(ca and cb and ca.value == cb.value),
        })
    return rows


def risk_of(mismatches: int) -> str:
    return "low" if mismatches == 0 else ("medium" if mismatches == 1 else "high")


async def run(lang: str, live: bool, gate: asyncio.Event) -> AsyncIterator[Event]:
    """Генерирует поток событий. На шаге 06 ждёт подтверждения человеком."""
    yield {"panel": "meta", "type": "stage", "stage": "received",
           "mode": "live" if live else "cached"}
    await asyncio.sleep(_pause(0.4))

    doc_a, doc_b = load_doc("a"), load_doc("b")

    yield {"panel": "a", "type": "line", "text": t(lang, "a.start")}
    yield {"panel": "b", "type": "line", "text": t(lang, "b.start")}
    await asyncio.sleep(_pause(0.8))

    # 02 Extracted — агенты работают параллельно и независимо.
    if live:
        res_a, res_b = await asyncio.gather(extract_live(doc_a), extract_live(doc_b))
    else:
        res_a, res_b = extract_offline(doc_a), extract_offline(doc_b)

    yield {"panel": "meta", "type": "stage", "stage": "extracted"}
    for i, key in enumerate(CLAUSES):
        label = t(lang, f"clause.{key}")
        for panel, res in (("a", res_a), ("b", res_b)):
            yield {"panel": panel, "type": "line", "text": t(lang, "read", clause=label)}
        await asyncio.sleep(_pause(0.5))
        for panel, res in (("a", res_a), ("b", res_b)):
            c = next((x for x in res if x.key == key), None)
            if not c:
                continue
            yield {"panel": panel, "type": "line", "text": t(lang, "found", label=label, value=c.value)}
            yield {"panel": panel, "type": "result", "key": key, "value": c.value, "source": c.source}
        await asyncio.sleep(_pause(0.7))

    for panel, res in (("a", res_a), ("b", res_b)):
        yield {"panel": panel, "type": "line", "text": t(lang, "done", n=len(res))}
    await asyncio.sleep(_pause(0.6))

    # 03 Verified → 04 Matched: ядро демо.
    yield {"panel": "meta", "type": "stage", "stage": "verified"}
    yield {"panel": "arbiter", "type": "line", "text": t(lang, "arbiter.start")}
    await asyncio.sleep(_pause(0.8))
    yield {"panel": "meta", "type": "stage", "stage": "matched"}

    rows = compare(res_a, res_b)
    for row in rows:
        label = t(lang, f"clause.{row['key']}")
        yield {"panel": "arbiter", "type": "line", "text": t(lang, "arbiter.compare", label=label)}
        await asyncio.sleep(_pause(0.9))
        text = (t(lang, "arbiter.match") if row["match"]
                else t(lang, "arbiter.mismatch", a=row["a"], b=row["b"]))
        yield {"panel": "arbiter", "type": "line", "text": text, "ok": row["match"]}
        yield {"panel": "arbiter", "type": "compare", "label": label, **row}
        await asyncio.sleep(_pause(0.5))

    yield {"panel": "arbiter", "type": "line", "text": t(lang, "arbiter.done")}
    mismatches = sum(1 for r in rows if not r["match"])
    risk = risk_of(mismatches)

    # 05 Drafted → 06 Awaiting approval: отчёт готов, но не отправлен.
    yield {"panel": "meta", "type": "stage", "stage": "drafted"}
    await asyncio.sleep(_pause(0.5))
    yield {"panel": "meta", "type": "stage", "stage": "awaiting_approval"}
    yield {"panel": "gate", "type": "approval_pending",
           "text": t(lang, "gate.text"), "button": t(lang, "gate.button")}

    # Пока ждём человека, в потоке НЕ должно быть тишины: Cloudflare и прочие
    # прокси рвут простаивающее соединение (~100 с → 524), и подтверждение
    # придёт уже в мёртвый поток. Пингуем, пока ждём.
    waited = 0.0
    while not gate.is_set():
        if waited >= config.GATE_TIMEOUT_SEC:
            yield {"panel": "gate", "type": "timeout"}
            return
        step = min(config.GATE_PING_SEC, config.GATE_TIMEOUT_SEC - waited)
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(asyncio.shield(gate.wait()), timeout=step)
        waited += step
        if not gate.is_set():
            yield {"panel": "meta", "type": "ping"}

    # 07 Sent — только после подтверждения человеком.
    summary = (t(lang, "verdict.none") if mismatches == 0
               else t(lang, "verdict.text", n=mismatches, risk=t(lang, f"risk.{risk}")))
    yield {"panel": "verdict", "type": "final", "mismatches": mismatches,
           "risk": risk, "title": t(lang, "verdict.title"), "text": summary, "rows": rows}
    yield {"panel": "arbiter", "type": "line", "text": t(lang, "sent")}
    yield {"panel": "meta", "type": "stage", "stage": "sent"}
