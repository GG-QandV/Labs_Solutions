[EN](../README.md) &nbsp;|&nbsp; [UA](README_uk.md) &nbsp;|&nbsp; [RU](README_ru.md)

# Labs Solutions

Automatyzacje AI i rozwiązania landingowe dla biznesu.

Prezentacja działających automatyzacji AI na rzeczywistych scenariuszach — ekstrakcja danych, weryfikacja, reguły biznesowe, zatwierdzenie przez człowieka oraz eksport do CRM, e-mail, PDF, zadań i raportów.

## Zawartość

- `docs/` — specyfikacje, prompt'y, analiza architektury, przewodniki wdrożeniowe
  - `docs/speech_translate/` — lokalny STT + chmurowy tłumacz MVP
- `backups/` — archiwa projektów (tar.gz, zip): buildy landingów, moduły demo

## Moduły demo

| Moduł | Opis |
|-------|------|
| **Landing Labs** | B2B landing dla AI automation lab — i18n (EN/UK), motywy, statyczny HTML/CSS/JS, prerender |
| **OpsHub** | Centrum operacyjne do orkiestracji parku demo |
| **RAG Demo** | Demo RAG — zapytania do dokumentów przez AI |
| **PDF Report** | Automatyczna generacja raportów PDF |
| **STT-LLM** | Rozpoznawanie mowy + przetwarzanie LLM |
| **Speech Translate** | Lokalna transkrypcja whisper.cpp + chmurowy tłumacz (specyfikacja MVP) |

## Stack

- **Landing:** Czysty HTML/CSS/JS, zero zależności, nginx statyka
- **Backend:** Python, kontrakty FastAPI
- **AI:** whisper.cpp, ONNX, API LLM (DeepSeek, opencode)
- **Infrastruktura:** Netcup VPS, Docker, Traefik, systemd

## Dokumentacja

- [Specyfikacja landing'u](Landing_Labs_fin_v.1.md) — architektura, i18n, wdrożenie
- [Prompt OpsHub](ПРОМПТ_OPSHUB_v1.md)
- [Prompt RAG demo](ПРОМПТ_RAG_ДЕМО_v1.1.md)
- [Specyfikacja Speech Translate MVP](speech_translate/SPEC_speech_local_MVP.md)
- [Porównanie VPS Netcup](VPS_Netcup.md)
