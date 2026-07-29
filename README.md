[UA](docs/README_uk.md) &nbsp;|&nbsp; [RU](docs/README_ru.md) &nbsp;|&nbsp; [PL](docs/README_pl.md)

# Labs Solutions

AI-powered automation demos and landing solutions for business.

Showcasing working AI automations on real scenarios — extraction, verification, business rules, human approval, and output into CRM, email, PDF, tasks, and reports.

## Contents

- `docs/` — specs, prompts, architecture analysis, deployment guides
  - `docs/speech_translate/` — local STT + cloud translation MVP
- `landing/` — **implemented** static landing site (laid out from the backup zip, UK version prerendered)
- `backups/` — project archives (tar.gz, zip): landing source, demo modules

## Start here

- [`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md) — source strategic plan (positioning, finance, jurisdictions, legal)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — canonical technical architecture + project tree
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — implementation plan with checklist

## Demo Modules

| Module | Description |
|--------|-------------|
| **Landing Labs** | B2B landing for AI automation lab — i18n (EN/UK), themes, static HTML/CSS/JS, prerender |
| **OpsHub** | Operations hub for demo park orchestration |
| **RAG Demo** | Retrieval-augmented generation demo with document queries |
| **PDF Report** | Automated PDF report generation pipeline |
| **STT-LLM** | Speech-to-text + LLM processing pipeline |
| **Speech Translate** | Local whisper.cpp transcription + cloud translation (MVP spec) |

## Stack

- **Landing:** Pure HTML/CSS/JS, zero dependencies, nginx static
- **Backend:** Python, FastAPI-compatible contracts
- **AI:** whisper.cpp, ONNX, LLM APIs (DeepSeek, opencode)
- **Infrastructure:** Netcup VPS, Docker, Traefik, systemd

## Docs

- [Landing site](landing/README.md) — implemented; run `cd landing && python3 build/prerender.py && python3 -m http.server 8080`
- [Landing Labs spec](docs/Landing_Labs_fin_v.1.md) — architecture, i18n, deployment
- [OpsHub prompt](docs/ПРОМПТ_OPSHUB_v1.md)
- [RAG demo prompt](docs/ПРОМПТ_RAG_ДЕМО_v1.1.md)
- [Speech Translate MVP spec](docs/speech_translate/SPEC_speech_local_MVP.md)
- [VPS Netcup comparison](docs/VPS_Netcup.md)
