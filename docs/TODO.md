# TODO

## D6 — MAIL_FROM на labs.mnemostroma.com (после миграции доменов)

Письма из демо уходят с `@solutions.dpdns.org`, а Resend будет верифицировать
`labs.mnemostroma.com`. До смены домена письма не будут отправляться.

Затрагиваемые файлы (код — инвариант §0.1 TASK_domains_migration.md, правится
отдельной задачей):

- `backend/rag-demo/app/config.py:39` — `MAIL_FROM` → `rag@labs.mnemostroma.com`
- `backend/pdf-demo-vps/packages/email-sender/src/index.ts:10` — `from` → `reports@labs.mnemostroma.com`
- `backend/pdf-demo-base/packages/email-sender/src/index.ts:10` — архивный модуль, трогать только при необходимости
- `backend/pdf-demo-vps/apps/server/src/index.ts:19` — дефолт `PUBLIC_BASE_URL` → `https://pdf.labs.mnemostroma.com`

**Порядок:**
1. Верифицировать `labs.mnemostroma.com` в Resend (MX/SPF/DKIM/DMARC из §3.1 TASK).
2. Сменить `MAIL_FROM` в указанных файлах.
3. Отдельный коммит на модуль; пересобрать демо на VPS.
