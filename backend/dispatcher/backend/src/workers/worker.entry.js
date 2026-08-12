// Standalone worker entry point.
// Use ONLY when running the worker as a separate container/process
// (WORKER_INLINE=false in the API container). Otherwise index.js
// imports the worker in-process — see AUDIT.md §3.4 "двойной запуск воркера".
import dotenv from 'dotenv';
dotenv.config();

import worker from './classificationWorker.js';

console.log('Classification worker started (standalone mode)');

const shutdown = async (signal) => {
  console.log(`${signal} received, closing worker...`);
  await worker.close();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
