import { createApp } from './app';
import { loadEnv } from './config/env';
import { PgKeyStore } from './db/keyStore';
import { migrate } from './db/migrate';
import { createPool } from './db/pool';
import { createLogger } from './logger';
import { KeyResolver } from './middleware/auth';
import { loadGatewayConfig } from './config/gatewayConfig';
import { createProviders } from './providers/registry';
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

  const app = createApp({
    keys: new KeyResolver(new PgKeyStore(pool)),
    router: new Router(config, providers),
    logger,
  });
  const server = app.listen(env.PORT, () => logger.info({ port: env.PORT }, 'gateway listening'));

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(() => void pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
