import express from "express";
import dotenv from 'dotenv';
import helmet from 'helmet';
import cookieParser from "cookie-parser";
import cors from "cors";
import http from 'http';

import routes from './src/routes/app.routes.js';
import { connectRedis, redisConnection } from "./src/config/redis.js";
import { initSocket } from './src/config/socket.js';
import { globalLimiter } from "./src/middleware/rateLimiter.js";
import telegramWebhook from './src/webhooks/telegram.webhook.js';
import prisma from './src/config/psql.js';
import { startHeartbeat } from './src/utils/opshub_client.js';

dotenv.config();

// AUDIT.md §3.4: upstream imported the worker here AND exposed `npm run worker`,
// which spawned two workers on the same queue. Now it is one explicit switch.
// WORKER_INLINE=true  -> single container (default, fleet MVP)
// WORKER_INLINE=false -> separate worker container via `npm run worker`
const WORKER_INLINE = process.env.WORKER_INLINE !== 'false';
if (WORKER_INLINE) {
  await import('./src/workers/classificationWorker.js');
  console.log('Classification worker started (inline mode)');
}

const app = express();
app.set('trust proxy', 1);

app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(helmet());

// Fleet convention: /health is unauthenticated, unrated and must answer fast.
// Registered before globalLimiter so OpsHub polling never eats the rate budget.
app.get('/health', async (req, res) => {
  const out = { ok: true, service: 'dispatcher', db: false, redis: false };
  try {
    await prisma.$queryRaw`SELECT 1`;
    out.db = true;
  } catch { out.ok = false; }
  try {
    await redisConnection.ping();
    out.redis = true;
  } catch { out.ok = false; }
  res.status(out.ok ? 200 : 503).json(out);
});

app.use(globalLimiter);
app.use('/api', routes);
app.use('/webhooks', telegramWebhook);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const server = http.createServer(app);

const start = async () => {
  await connectRedis();
  await initSocket(server);
  const port = process.env.PORT || 8080;
  server.listen(port, () => console.log(`dispatcher API on :${port}`));
  startHeartbeat();
};

start();
