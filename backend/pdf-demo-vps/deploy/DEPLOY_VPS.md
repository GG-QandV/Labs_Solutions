# Deploy: PDF Report Demo on VPS (Netcup 1000 G12, Traefik + OpsHub conventions)

## 0. Host prerequisites (once per VPS)
Ubuntu 24.04, Docker + Compose, ufw (80/443/SSH), fail2ban, SSH keys only.
```bash
docker network create web || true
docker network create opsnet || true
docker compose -f deploy/traefik-compose.yml up -d     # if Traefik not running yet
```
Cloudflare DNS: A record solutions.dpdns.org -> VPS IP (proxy ON keeps CF as CDN/WAF;
for Let's Encrypt HTTP-challenge either set SSL mode "Full" after first issuance,
or temporarily grey-cloud the record during the first certificate request).

## 1. Secrets
`/srv/demos/pdf-demo/.env`:
```
RESEND_API_KEY=...
OPSHUB_KEY=...        # same shared key as the OpsHub stack
```
Resend: verify solutions.dpdns.org (SPF/DKIM records in Cloudflare DNS).

## 2. Deploy
```bash
git clone <repo> /srv/demos/pdf-demo/src && cd /srv/demos/pdf-demo/src
docker compose -f deploy/docker-compose.yml --env-file /srv/demos/pdf-demo/.env up -d --build
```
Update = `git pull && docker compose ... up -d --build` (or a GitHub Action doing the same over SSH).

## 3. Smoke checklist
1. https://solutions.dpdns.org -> Start demo session -> timer.
2. Public test Sheet -> Check access -> validation report (rows/images/hidden warning).
3. Break an image URL -> BROKEN_IMAGE + upload button -> upload PNG -> resolved.
4. Email + A4/Legal -> Generate -> validating -> rendering -> sending -> Sent; PDF arrives.
5. Launch 3 jobs at once -> 2 render (Chromium x2), 1 queued.
6. OpsHub dashboard shows pdf-demo green, heartbeats flowing; kill the process ->
   restart: on-failure brings it back, crash visible in OpsHub logs.
7. Files under /srv/demos/pdf-demo/data older than 24h are swept hourly.

## Differences vs the Cloudflare build (same repo)
- apps/server (Fastify + SQLite + Playwright) replaces apps/worker (kept as cloud reference).
- KV/R2 -> SQLite (/data/app.db) + local files; Browser Rendering -> system Chromium; no pdf-lib fallback (no daily browser quota on VPS).
- In-process queue (concurrency 2) instead of waitUntil; isolated for a future BullMQ swap.
