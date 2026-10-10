import { createApp } from './app';
import { ResponseCache } from './cache/ResponseCache';
import { loadEnv } from './config/env';
import { loadGatewayConfig } from './config/gatewayConfig';
import { PgKeyStore } from './db/keyStore';
import { migrate } from './db/migrate';
import { createPool } from './db/pool';
import { BudgetTracker } from './limits/BudgetTracker';
import { RateLimiter } from './limits/RateLimiter';
import { monthlyTokensFromLog, PgLogWriter } from './logging/requestLog';
import { createLogger } from './logger';
import { Metrics } from './metrics/metrics';
import { KeyResolver } from './middleware/auth';
import { createProviders } from './providers/registry';
import { createRedis, waitForRedis } from './redis/client';
import { CircuitBreakers, RedisBreakerStore } from './reliability/CircuitBreaker';
import { Router } from './router/Router';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const config = loadGatewayConfig(env.GATEWAY_CONFIG);

  const pool = createPool(env.DATABASE_URL);
  const applied = await migrate(pool);
  if (applied.length) logger.info({ applied }, 'migrations applied');

  const redis = createRedis(env.REDIS_URL, logger);
  if (!(await waitForRedis(redis)))
    logger.warn('redis not reachable at startup; running on in-memory fallbacks');

  const providers = createProviders(config, process.env, logger);
  logger.info({ providers: [...providers.keys()] }, 'providers ready');

  const metrics = new Metrics();
  const onFallback = (component: string) => metrics.redisFallbacks.inc({ component });
  const breakers = new CircuitBreakers(
    config.breaker,
    new RedisBreakerStore(redis, config.breaker),
    {
      logger,
      onFallback,
    },
  );
  metrics.watchBreakers(breakers, [...providers.keys()]);

  const logs = new PgLogWriter(pool, { logger, onDrop: (n) => metrics.logDrops.inc(n) });
  const keys = new KeyResolver(new PgKeyStore(pool));
  const router = new Router(config, providers, breakers, {
    logger,
    onProviderFailure: (provider, code) => metrics.providerFailures.inc({ provider, code }),
  });

  const app = createApp({
    keys,
    router,
    limiter: new RateLimiter(redis, { logger, onFallback }),
    budget: new BudgetTracker(redis, {
      logger,
      onFallback,
      seed: (keyId, monthStart) => monthlyTokensFromLog(pool, keyId, monthStart),
    }),
    cache: new ResponseCache(redis, { ttlSeconds: config.cache.ttlSeconds, logger, onFallback }),
    cacheKeyOptions: config.cache,
    logs,
    prices: config.prices,
    metrics,
    logPrompts: env.LOG_PROMPTS,
    health: {
      providers,
      breakers,
      checkPostgres: async () => (await pool.query('SELECT 1')).rowCount === 1,
      checkRedis: async () => (await redis.ping()) === 'PONG',
    },
    logger,
  });
  const server = app.listen(env.PORT, () => logger.info({ port: env.PORT }, 'gateway listening'));

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      void logs
        .close()
        .finally(() => {
          redis.disconnect();
          return pool.end();
        })
        .finally(() => process.exit(0));
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
