import { createApp } from './app';
import { loadEnv } from './config/env';
import { PgKeyStore } from './db/keyStore';
import { migrate } from './db/migrate';
import { createPool } from './db/pool';
import { createLogger } from './logger';
import { KeyResolver } from './middleware/auth';
import { loadGatewayConfig } from './config/gatewayConfig';
import { createProviders } from './providers/registry';
import { ResponseCache } from './cache/ResponseCache';
import { BudgetTracker } from './limits/BudgetTracker';
import { RateLimiter } from './limits/RateLimiter';
import { createRedis, waitForRedis } from './redis/client';
import { CircuitBreakers, RedisBreakerStore } from './reliability/CircuitBreaker';
import { Router } from './router/Router';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const pool = createPool(env.DATABASE_URL);
  const applied = await migrate(pool);
  if (applied.length) logger.info({ applied }, 'migrations applied');

  const config = loadGatewayConfig(env.GATEWAY_CONFIG);
  const providers = createProviders(config, process.env, logger);
  logger.info({ providers: [...providers.keys()] }, 'providers ready');

  const redis = createRedis(env.REDIS_URL, logger);
  if (!(await waitForRedis(redis)))
    logger.warn('redis not reachable at startup; running on in-memory fallbacks');
  const breakers = new CircuitBreakers(
    config.breaker,
    new RedisBreakerStore(redis, config.breaker),
    { logger },
  );

  const app = createApp({
    keys: new KeyResolver(new PgKeyStore(pool)),
    router: new Router(config, providers, breakers, { logger }),
    limiter: new RateLimiter(redis, { logger }),
    budget: new BudgetTracker(redis, { logger }),
    cache: new ResponseCache(redis, { ttlSeconds: config.cache.ttlSeconds, logger }),
    cacheKeyOptions: config.cache,
    logger,
  });
  const server = app.listen(env.PORT, () => logger.info({ port: env.PORT }, 'gateway listening'));

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      redis.disconnect();
      void pool.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
