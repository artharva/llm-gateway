import Redis from 'ioredis';

export async function testRedis(): Promise<Redis> {
  const redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1 });
  await redis.flushdb();
  return redis;
}
