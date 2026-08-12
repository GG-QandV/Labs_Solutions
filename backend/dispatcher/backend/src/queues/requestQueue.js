import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis.js';

export const requestQueue = new Queue('requests', {
  connection: redisConnection,
});