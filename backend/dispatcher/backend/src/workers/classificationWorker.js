import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import prisma from '../config/psql.js';
import { redisConnection } from '../config/redis.js';
import { classifyRequest } from '../services/gemini.services.js';

const publisher = new Redis(process.env.REDIS_URL, {
  tls: process.env.REDIS_URL?.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
  maxRetriesPerRequest: null,
});

const worker = new Worker(
  'requests',
  async (job) => {
    const { requestId } = job.data;

    await prisma.customerRequest.update({
      where: { id: requestId },
      data: { status: 'PROCESSING' },
    });

    await prisma.requestEvent.create({
      data: {
        requestId,
        eventType: 'STATUS_CHANGED',
        oldValue: 'QUEUED',
        newValue: 'PROCESSING',
        metadata: JSON.stringify({ trigger: 'worker_started' }),
      },
    });

    try {
      const request = await prisma.customerRequest.findUnique({
        where: { id: requestId },
      });

      const classification = await classifyRequest(request.message);

      await prisma.aiClassification.create({
        data: {
          requestId,
          provider: classification.provider || 'gemini',
          category: classification.category,
          priority: classification.priority,
          summary: classification.summary,
          confidence: classification.confidence,
          reason: classification.reason,
          rawOutput: JSON.stringify(classification),
        },
      });

      await prisma.customerRequest.update({
        where: { id: requestId },
        data: {
          status: 'CLASSIFIED',
          categorySnapshot: classification.category,
          prioritySnapshot: classification.priority,
        },
      });

      await prisma.requestEvent.create({
        data: {
          requestId,
          eventType: 'CLASSIFIED',
          newValue: 'CLASSIFIED',
          metadata: JSON.stringify({
            category: classification.category,
            priority: classification.priority,
            confidence: classification.confidence,
          }),
        },
      });

      await publisher.publish('request:classified', JSON.stringify({
        requestId,
        category: classification.category,
        priority: classification.priority,
        summary: classification.summary,
        reason: classification.reason,
        confidence: classification.confidence,
      }));

    } catch (err) {
      console.error('Classification error:', err.message);

      await prisma.aiClassification.upsert({
        where: { requestId },
        update: { errorState: err.message },
        create: {
          requestId,
          provider: 'unknown',
          category: 'unknown',
          priority: 'LOW',
          summary: 'Classification failed',
          confidence: 0,
          reason: 'Error during classification',
          rawOutput: '{}',
          errorState: err.message,
        },
      });

      await prisma.customerRequest.update({
        where: { id: requestId },
        data: { status: 'FAILED' },
      });

      await prisma.requestEvent.create({
        data: {
          requestId,
          eventType: 'CLASSIFICATION_FAILED',
          newValue: 'FAILED',
          metadata: JSON.stringify({ error: err.message }),
        },
      });

      await publisher.publish('request:failed', JSON.stringify({
        requestId,
        error: err.message,
      }));
    }
  },
  {
    connection: redisConnection,
    concurrency: 1,
  }
);

worker.on('completed', (job) => console.log(`Job ${job.id} completed`));
worker.on('failed', (job, err) => console.error(`Job ${job.id} failed:`, err.message));

export default worker;