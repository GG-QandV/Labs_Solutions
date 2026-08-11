# ---------- build ----------
FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json turbo.json ./
COPY packages ./packages
COPY apps/web ./apps/web
COPY apps/server ./apps/server
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @demo/web build && pnpm --filter @demo/server build

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime
# System Chromium for Playwright + fonts (Cyrillic-capable)
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-liberation fonts-dejavu-core ca-certificates dumb-init \
    && rm -rf /var/lib/apt/lists/*
ENV CHROMIUM_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    DATA_DIR=/data \
    WEB_DIST=/repo/web/dist \
    PORT=8080
WORKDIR /repo
# pnpm prod install — recreate correct workspace symlinks instead of COPYing broken ones
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json turbo.json ./
COPY packages ./packages
COPY apps/server/package.json ./apps/server/package.json
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /repo/apps/server/dist/server.js ./apps/server/dist/server.js
COPY --from=build /repo/apps/web/dist ./web/dist
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/server/dist/server.js"]
