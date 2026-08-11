# Deploy: solutions.dpdns.org (Cloudflare Free plan)

> АРХИВ. Cloudflare-вариант (Workers/Pages), не используется на VPS.
> Актуальный деплой — `DEPLOY_VPS.md` в этой же папке.

## 0. Prerequisites
- Cloudflare account with the zone `solutions.dpdns.org` added (Free plan is enough).
- Resend account (free: 100 emails/day).
- `pnpm i` at repo root; `npx wrangler login`.

## 1. Create resources
```bash
npx wrangler kv namespace create KV          # copy the id into apps/worker/wrangler.toml
npx wrangler r2 bucket create pdf-demo-files
# 24h lifecycle for temp files (uploads + oversized PDFs):
npx wrangler r2 bucket lifecycle add pdf-demo-files --prefix "" --expire-days 1
```

## 2. Secrets
```bash
cd apps/worker
npx wrangler secret put RESEND_API_KEY       # paste your Resend API key
```

## 3. Verify the sender domain in Resend
Resend dashboard -> Domains -> Add `solutions.dpdns.org`.
Add the DNS records Resend shows (TXT for SPF/DKIM) into Cloudflare DNS for the zone.
Wait for "Verified", then the `from: reports@solutions.dpdns.org` address works.

## 4. Deploy the Worker (API)
```bash
cd apps/worker
npx wrangler deploy
```
The route `solutions.dpdns.org/api/*` is declared in wrangler.toml (path-based routing
was chosen over an api. subdomain: one certificate, no extra DNS, same-origin frontend calls).

## 5. Deploy the frontend (Pages)
```bash
cd apps/web && pnpm build
npx wrangler pages project create pdf-demo-web
npx wrangler pages deploy dist --project-name=pdf-demo-web
```
Pages -> pdf-demo-web -> Custom domains -> add `solutions.dpdns.org`.

## 6. Smoke checklist
1. Open https://solutions.dpdns.org -> "Start demo session" -> timer appears.
2. Paste a public test Sheet (File -> Share -> Anyone with the link) -> "Check access".
3. Validation report shows rows/columns/images; break one image URL -> BROKEN_IMAGE warning + upload button.
4. Upload a PNG for that row -> re-validation shows it resolved.
5. Enter email, pick A4 or Legal -> Generate -> statuses: validating -> rendering -> sending -> Sent.
6. Email arrives with the PDF attached (cover + cards, images scaled with object-fit: contain).
7. Burn the daily Browser Rendering quota (10 min) -> next job returns a PDF with
   "simplified rendering mode" note (pdf-lib fallback).

## Free-plan limits baked into the code
- Browser closed immediately after page.pdf() (10 min/day budget).
- waitUntil() instead of Queues; processJob() is a self-contained function —
  attach it to a Queues consumer after upgrading, nothing else changes.
- Rate limits: 5 jobs/hour/token, 10/hour/IP, 90 emails/day (buffer under Resend's 100).
