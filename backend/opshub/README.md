# OpsHub — fleet control plane (VPS Netcup 1000 G12)

Logs (error/critical only) + docker events + health poll + metrics + dashboard + launcher
for 8-20 demo services. Single container, SQLite, <=128 MB RAM.

## Security note (read this)
The launcher needs **rw** access to /var/run/docker.sock — that is root-equivalent on the host.
Mitigations in place: nothing is exposed without auth (dashboard = basic auth, fleet API = X-OpsHub-Key),
the container publishes no ports directly (Traefik only), demos talk over the internal `opsnet` network.
Future hardening: docker-socket-proxy with an API whitelist (growth area).

## Run
```bash
docker network create web || true
cp .env.example .env   # set OPSHUB_KEY, ADMIN_PASSWORD
docker compose up -d --build
```
Dashboard: https://ops.labs.mnemostroma.com (basic auth).

## Fleet convention (every demo compose)
```yaml
labels: ["demo=true", "traefik.enable=true", ...]
mem_limit: <budget>      # native leak protection: cgroup OOM kill
restart: on-failure      # docker auto-restarts after OOM/crash
environment: [OPSHUB_URL=http://opshub:8700, OPSHUB_KEY=${OPSHUB_KEY}, OPSHUB_SERVICE=<name>]
networks: [web, opsnet]
```
Integrate the drop-in client from /clients (Python or TS): register on boot,
send only ERROR/CRITICAL, heartbeat on requests (drives autostop + polite nightly restarts).

## Behaviors
- Start blocked at 3 running demos ("Stop one of: ...").
- Autostop after `autostop_minutes` (default 30) without a heartbeat.
- Nightly restart 04:00 per service (leak hygiene); active session (heartbeat <10 min) defers +1h, max 3.
- OOM/crash events land in logs automatically via docker events (no client code needed).
- Retention: logs/events 30d, metrics 7d; VACUUM weekly.
