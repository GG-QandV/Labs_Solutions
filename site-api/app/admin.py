"""Admin panel — /admin (Basic Auth) + JSON API /api/v1/admin/*."""
from __future__ import annotations

import base64
import secrets
import time
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from . import config
from .db import db

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])

VALID_STATUSES = ("received", "reviewing", "scheduled", "answered", "closed")


# ---------- auth ----------
def _check_basic(request: Request) -> None:
    if not config.ADMIN_PASSWORD:
        raise HTTPException(503, "Admin panel is not configured (SITE_ADMIN_PASSWORD unset).")
    hdr = request.headers.get("authorization", "")
    if not hdr.startswith("Basic "):
        raise HTTPException(401, "auth required", headers={"WWW-Authenticate": 'Basic realm="admin"'})
    try:
        decoded = base64.b64decode(hdr[6:]).decode()
        login, pwd = decoded.split(":", 1)
    except Exception:  # noqa: BLE001
        raise HTTPException(401, "invalid credentials", headers={"WWW-Authenticate": 'Basic realm="admin"'})
    if not secrets.compare_digest(login, config.ADMIN_LOGIN) or not secrets.compare_digest(pwd, config.ADMIN_PASSWORD):
        raise HTTPException(401, "invalid credentials", headers={"WWW-Authenticate": 'Basic realm="admin"'})


# ---------- slots ----------
class SlotBody(BaseModel):
    starts_at: int = Field(gt=0)   # unix ts
    duration_min: int = Field(default=30, ge=10, le=240)


@router.get("/slots", dependencies=[Depends(_check_basic)])
async def slots():
    return db.list_slots()


@router.post("/slots", status_code=201, dependencies=[Depends(_check_basic)])
async def add_slot(body: SlotBody):
    if body.starts_at < int(time.time()):
        raise HTTPException(400, "Slot time must be in the future.")
    sid = db.add_slot(body.starts_at, body.duration_min)
    return {"id": sid, "starts_at": body.starts_at, "duration_min": body.duration_min, "status": "open"}


@router.delete("/slots/{slot_id}", status_code=204, dependencies=[Depends(_check_basic)])
async def delete_slot(slot_id: int):
    if not db.delete_slot(slot_id):
        raise HTTPException(409, "Slot is booked or does not exist — cannot delete.")


# ---------- requests ----------
@router.get("/requests", dependencies=[Depends(_check_basic)])
async def requests(limit: int = 50):
    limit = max(1, min(limit, 200))
    return db.list_requests(limit)


class StatusBody(BaseModel):
    status: str
    next_step: str | None = None


@router.post("/requests/{ref}/status", dependencies=[Depends(_check_basic)])
async def set_status(ref: str, body: StatusBody):
    if body.status not in VALID_STATUSES:
        raise HTTPException(400, f"Invalid status. Allowed: {', '.join(VALID_STATUSES)}")
    if not db.set_request_status(ref, body.status, body.next_step):
        raise HTTPException(404, "Request not found")
    return {"ref": ref, "status": body.status, "next_step": body.next_step}


# ---------- UI ----------
def _fmt(ts: int | None) -> str:
    if not ts:
        return "—"
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M")


@router.get("/admin", response_class=HTMLResponse, include_in_schema=False)
async def admin_page(request: Request):
    _check_basic(request)
    slots_html = "".join(
        f"<tr><td>{_fmt(s['starts_at'])}</td><td>{s['duration_min']}m</td>"
        f"<td>{s['status']}</td>"
        f"<td><button data-del='{s['id']}'>Delete</button></td></tr>"
        for s in db.list_slots()
    ) or "<tr><td colspan='4'>No slots yet</td></tr>"
    reqs_html = "".join(
        f"<tr><td>{r['ref']}</td><td>{r['name']}</td><td>{r['email']}</td>"
        f"<td>{r.get('service') or '—'}</td><td>{_fmt(r.get('slot_starts_at'))}</td>"
        f"<td>{r['status']}</td>"
        f"<td><select data-ref='{r['ref']}'>"
        + "".join(f"<option value='{v}'{' selected' if v == r['status'] else ''}>{v}</option>" for v in VALID_STATUSES)
        + "</select>"
        f"<input data-ns='{r['ref']}' placeholder='next step' value='{r.get('next_step') or ''}'>"
        f"<button data-apply='{r['ref']}'>Apply</button></td></tr>"
        for r in db.list_requests(100)
    ) or "<tr><td colspan='7'>No requests yet</td></tr>"
    return HTMLResponse(f"""<!doctype html><html><head><meta charset="utf-8"><title>Labs Admin</title>
<style>body{{font:14px/1.5 system-ui;margin:2rem;max-width:1200px}}table{{border-collapse:collapse;width:100%}}
td,th{{border:1px solid #ddd;padding:6px 8px;text-align:left}}button{{cursor:pointer}}
.actions button{{margin:0 2px}}</style></head><body>
<h1>Labs Admin</h1>
<h2>Slots</h2>
<form id="slotForm"><input type="datetime-local" id="slotWhen" required>
<input type="number" id="slotMin" value="30" min="10" max="240" style="width:70px"> min
<button type="submit">Add slot</button></form>
<table id="slots"><tr><th>Starts</th><th>Duration</th><th>Status</th><th></th></tr>{slots_html}</table>
<h2>Requests</h2>
<table><tr><th>Ref</th><th>Name</th><th>Email</th><th>Service</th><th>Slot</th><th>Status</th><th>Actions</th></tr>{reqs_html}</table>
<script>
const H={{'Content-Type':'application/json'}};
document.getElementById('slotForm').onsubmit=async e=>{{
  e.preventDefault();
  const when=new Date(document.getElementById('slotWhen').value);
  const starts_at=Math.floor(when.getTime()/1000);
  const duration_min=+document.getElementById('slotMin').value;
  const r=await fetch('/api/v1/admin/slots',{{method:'POST',headers:H,body:JSON.stringify({{starts_at,duration_min}})}});
  if(r.ok)location.reload();else alert((await r.json()).detail);
}};
document.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{{
  await fetch('/api/v1/admin/slots/'+b.dataset.del,{{method:'DELETE'}});location.reload();
}});
document.querySelectorAll('[data-apply]').forEach(b=>b.onclick=async()=>{{
  const ref=b.dataset.apply;
  const status=document.querySelector(`[data-ref="${{ref}}"]`).value;
  const next_step=document.querySelector(`[data-ns="${{ref}}"]`).value||null;
  const r=await fetch('/api/v1/admin/requests/'+ref+'/status',{{method:'POST',headers:H,body:JSON.stringify({{status,next_step}})}});
  if(r.ok)location.reload();else alert((await r.json()).detail);
}});
</script></body></html>""")


def register(app) -> None:
    app.include_router(router)
