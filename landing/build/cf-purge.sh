#!/usr/bin/env bash
# Purge Cloudflare cache for labs.mnemostroma.com after deploy.
# Token: CF_PURGE_API_TOKEN in /srv/traefik/.env on VPS (Zone.Cache Purge).
set -euo pipefail
ZONE="a0192f430276e38e736606107687a95f"
TOKEN="${CF_PURGE_API_TOKEN:?export CF_PURGE_API_TOKEN first (source /srv/traefik/.env)}"
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE/purge_cache" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data '{"purge_everything":true}' | grep -o '"success":[a-z]*'
