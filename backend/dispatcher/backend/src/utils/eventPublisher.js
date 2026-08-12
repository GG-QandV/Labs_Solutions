import { createClient } from 'redis';

let publisher;

async function getPublisher() {
  if (!publisher) {
    publisher = createClient({ url: process.env.REDIS_URL });
    publisher.on('error', (err) => console.error('Redis publisher error:', err));
    await publisher.connect();
  }
  return publisher;
}

export async function publishRequestEvent(event) {
  const client = await getPublisher();
  await client.publish('request:event', JSON.stringify(event));
}
