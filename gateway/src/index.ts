import { createApp } from './app';
import { loadEnv } from './config/env';
import { PgKeyStore } from './db/keyStore';
import { migrate } from './db/migrate';
import { createPool } from './db/pool';
import { createLogger } from './logger';
import { KeyResolver } from './middleware/auth';
import { GroqProvider } from './providers/groq';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const pool = createPool(env.DATABASE_URL);
  const applied = await migrate(pool);
  if (applied.length) logger.info({ applied }, 'migrations applied');

  const app = createApp({
    keys: new KeyResolver(new PgKeyStore(pool)),
    provider: new GroqProvider(process.env.GROQ_API_KEY ?? ''),
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
