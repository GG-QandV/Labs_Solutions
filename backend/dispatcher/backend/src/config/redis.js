import { Redis } from 'ioredis';

const getRedisOptions = () => {
  const redisUrl = process.env.REDIS_URL || '';
  const isExternalRedis = redisUrl.startsWith('rediss://');
  return {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    tls: isExternalRedis ? { rejectUnauthorized: false } : undefined,
  };
};

export const redisConnection = new Redis(process.env.REDIS_URL, getRedisOptions());

export const createRedisClient = () => new Redis(process.env.REDIS_URL, getRedisOptions());

export async function connectRedis() {
  await redisConnection.ping();
  console.log('Redis connected');
}

export default redisConnection;