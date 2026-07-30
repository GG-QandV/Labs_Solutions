"""stt-mvp entrypoint (LLM module wired in; the STT pipeline mounts alongside per the base prompt)."""
from fastapi import FastAPI
from .llm.router import router as llm_router

app = FastAPI(title="stt-mvp", docs_url=None, redoc_url=None)
app.include_router(llm_router)

@app.get("/health")
async def health():
    return {"ok": True}
