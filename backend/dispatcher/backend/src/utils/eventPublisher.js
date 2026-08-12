import { Redis } from 'ioredis';

let publisher;

async function getPublisher() {
  if (!publisher) {
    publisher = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    publisher.on('error', (err) => console.error('Redis publisher error:', err));
  }
  return publisher;
}

export async function publishRequestEvent(event) {
  const client = await getPublisher();
  await client.publish('request:event', JSON.stringify(event));
}
