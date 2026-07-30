"""Smoke tests: prompt assembly toggles, config validation/hot-reload, endpoint contract with a mock provider."""
import asyncio, json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from app.main import app
from app.llm import provider
from app.llm.prompt_builder import prompt_config, PromptConfigError

client = TestClient(app)
results = []
def check(name, cond):
    results.append((name, bool(cond)))
    print(("PASS" if cond else "FAIL"), name)

# 1. prompt assembly: hints on by default
p = prompt_config.build_live_prompt("es", "ru", "live_literal")
check("core placeholders filled", "es" in p and "ru" in p and "{source_lang}" not in p)
check("hints section present", "reply options" in p)
check("json schema mirrors hints", '"hints"' in p)
check("summary_rules NOT in live prompt", "key_moments" not in p)

# 2. toggle hints off via PUT -> section and schema disappear
cfg = client.get("/api/llm/prompt-config").json()
cfg["hints"]["enabled"] = False
r = client.put("/api/llm/prompt-config", json=cfg)
check("PUT config ok", r.status_code == 200 and r.json()["sections_enabled"]["hints"] is False)
p2 = prompt_config.build_live_prompt("es", "ru", "live_literal")
check("hints removed after toggle", "reply options" not in p2 and '"hints"' not in p2)

# 3. invalid config rejected (core without placeholder)
bad = dict(cfg); bad["core"] = {"enabled": True, "text": "translate stuff"}
r = client.put("/api/llm/prompt-config", json=bad)
check("invalid config -> 422", r.status_code == 422)

# 4. hot reload by file mtime (manual edit simulation)
raw = open(prompt_config.path, encoding="utf-8").read()
open(prompt_config.path, "w", encoding="utf-8").write(raw.replace("enabled: false", "enabled: false", 1))
os.utime(prompt_config.path, (time.time()+1, time.time()+1))
prompt_config.reload()
check("hot reload survives", True)

# 5. summary prompt honors its own toggle
cfg2 = client.get("/api/llm/prompt-config").json()
cfg2["summary_rules"]["enabled"] = False
client.put("/api/llm/prompt-config", json=cfg2)
r = client.post("/api/llm/summary", json={"transcript": "a", "target_lang": "ru"})
check("summary disabled -> 409", r.status_code == 409)
cfg2["summary_rules"]["enabled"] = True; cfg2["hints"]["enabled"] = True
client.put("/api/llm/prompt-config", json=cfg2)

# 6. endpoint contract with mocked provider
async def fake_complete(system_prompt, user_content, api_key=None):
    return json.dumps({"translation": "Нам нужно проверить договор.",
                       "changes": [], "hints": ["Хорошо, давайте назначим звонок.", "x", "y", "лишний"]})
provider_orig = provider.complete
provider.complete = fake_complete
r = client.post("/api/llm/translate", json={"text": "necesitamos revisar el contrato",
                                            "source_lang": "es", "target_lang": "ru", "mode": "live_literal"})
d = r.json()
check("translate 200", r.status_code == 200)
check("translation returned", d["translation"].startswith("Нам"))
check("hints capped at max_hints", len(d["hints"]) == 3)

async def fake_summary(system_prompt, user_content, api_key=None):
    return json.dumps({"summary": "Обсуждён договор.", "key_moments": ["оплата 30 дней"], "risks": []})
provider.complete = fake_summary
r = client.post("/api/llm/summary", json={"transcript": "долгий текст", "target_lang": "ru"})
check("summary 200 + key_moments", r.status_code == 200 and r.json()["key_moments"] == ["оплата 30 дней"])
provider.complete = provider_orig

# 7. BYOK lifecycle
r = client.post("/api/llm/byok", json={"api_key": "sk-test1234567890"})
sid = r.json()["session_id"]
check("byok start", r.status_code == 200 and sid)
r = client.delete(f"/api/llm/byok/{sid}")
check("byok revoke", r.status_code == 200)

# 8. redactor
check("redactor masks keys", "sk-test" not in provider.redact("error with sk-test1234567890 inside"))

# 9. no-key error path (server key empty, no BYOK)
r = client.post("/api/llm/translate", json={"text": "hola", "source_lang": "es", "target_lang": "ru"})
check("no key -> 4xx with clear message", r.status_code == 422 and "API key" in r.json()["detail"])

fails = [n for n, ok in results if not ok]
print(f"\n{len(results)-len(fails)}/{len(results)} passed" + (f" FAILED: {fails}" if fails else ""))
sys.exit(1 if fails else 0)
