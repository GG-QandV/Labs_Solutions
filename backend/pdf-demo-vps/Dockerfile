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
FROM node:22-bookworm-slim
# System Chromium for Playwright + fonts (Cyrillic-capable)
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-liberation fonts-dejavu-core ca-certificates dumb-init \
    && rm -rf /var/lib/apt/lists/*
ENV CHROMIUM_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    DATA_DIR=/data \
    WEB_DIST=/app/web \
    PORT=8080
WORKDIR /app
COPY --from=build /repo/apps/server/dist/server.js ./server.js
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/server/node_modules ./server_modules
COPY --from=build /repo/apps/web/dist ./web
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["dumb-init", "--"]
ENV NODE_PATH=/app/node_modules:/app/server_modules
CMD ["node", "server.js"]
