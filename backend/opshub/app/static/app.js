const grid = document.getElementById("grid");
const logList = document.getElementById("logList");
const svcFilter = document.getElementById("svcFilter");
const counter = document.getElementById("counter");
let knownServices = new Set();

function toast(msg) {
  let t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.style.display = "block";
  setTimeout(() => (t.style.display = "none"), 4000);
}

function spark(canvas, points) {
  const ctx = canvas.getContext("2d");
  const w = (canvas.width = canvas.offsetWidth * 2), h = (canvas.height = 68);
  ctx.clearRect(0, 0, w, h);
  if (!points || points.length < 2) return;
  const max = Math.max(...points, 1);
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = (i / (points.length - 1)) * w, y = h - (p / max) * (h - 6) - 3;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.strokeStyle = "#8fd0c9"; ctx.lineWidth = 2; ctx.stroke();
}

async function act(name, action, btn) {
  btn.disabled = true;
  const res = await fetch(`/api/services/${name}/${action}`, { method: "POST" });
  if (!res.ok) toast((await res.json()).detail ?? "action failed");
  btn.disabled = false;
  refresh();
}

async function refresh() {
  const res = await fetch("/api/overview");
  if (!res.ok) return;
  const data = await res.json();
  counter.textContent = `running ${data.running}/${data.max_running}` + (data.docker ? "" : " · docker offline");
  counter.classList.toggle("full", data.running >= data.max_running);
  grid.innerHTML = "";
  for (const s of data.services) {
    if (!knownServices.has(s.name)) {
      knownServices.add(s.name);
      const o = document.createElement("option"); o.value = s.name; o.textContent = s.name;
      svcFilter.appendChild(o);
    }
    const card = document.createElement("div"); card.className = "card";
    const dotCls = s.recent_error ? "err" : s.state;
    card.innerHTML = `
      <h3><span class="dot ${dotCls}"></span>${s.name}</h3>
      <div class="meta">${s.state} · ${s.mem_mb ?? "–"} MB · ${s.cpu_pct ?? "–"}% CPU</div>
      <canvas class="spark"></canvas>
      <div class="btns">
        <button data-a="start" ${s.state === "running" ? "disabled" : ""}>start</button>
        <button data-a="stop" ${s.state !== "running" ? "disabled" : ""}>stop</button>
        <button data-a="restart" ${s.state !== "running" ? "disabled" : ""}>restart</button>
      </div>`;
    card.querySelectorAll("button").forEach(b =>
      b.addEventListener("click", () => act(s.name, b.dataset.a, b)));
    grid.appendChild(card);
    spark(card.querySelector("canvas"), s.spark);
  }
  loadLogs();
}

async function loadLogs() {
  const q = svcFilter.value ? `?service=${encodeURIComponent(svcFilter.value)}` : "";
  const res = await fetch(`/api/logs${q}`);
  if (!res.ok) return;
  const logs = await res.json();
  logList.innerHTML = "";
  for (const l of logs) {
    const li = document.createElement("li");
    li.className = l.level;
    const when = new Date(l.ts * 1000).toLocaleString();
    li.innerHTML = `<div class="lmeta">${when} · ${l.service} · ${l.event}</div>
      <div>${escapeHtml(l.message)}</div>
      ${l.traceback ? `<pre>${escapeHtml(l.traceback)}</pre>` : ""}`;
    li.addEventListener("click", () => li.classList.toggle("open"));
    logList.appendChild(li);
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

svcFilter.addEventListener("change", loadLogs);
refresh();
setInterval(refresh, 5000);
