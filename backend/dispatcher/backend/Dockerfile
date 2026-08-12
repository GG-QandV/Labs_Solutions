FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .
RUN npx prisma generate

EXPOSE 8080

# `db push` instead of `migrate deploy`: upstream Postgres migrations were
# dropped during vendoring (AUDIT.md §3.1) and SQLite schema is created from
# schema.prisma directly. Seed is idempotent and safe to re-run.
CMD ["sh", "-c", "npx prisma db push --skip-generate && node scripts/seed.js && node index.js"]
