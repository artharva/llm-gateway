import express from 'express';
import type { CacheKeyOptions } from './cache/cacheKey';
import type { ResponseCache } from './cache/ResponseCache';
import type { BudgetTracker } from './limits/BudgetTracker';
import type { RateLimiter } from './limits/RateLimiter';
import type { Price } from './logging/cost';
import type { LogSink } from './logging/requestLog';
import type { Logger } from './logger';
import type { Metrics } from './metrics/metrics';
import type { KeyResolver } from './middleware/auth';
import { errorHandler, notFound, requestId } from './middleware/errors';
import type { Router } from './router/Router';
import { chatRoutes } from './routes/chat';
import { healthRoutes, type HealthDeps } from './routes/health';

export interface AppDeps {
  keys: KeyResolver;
  router: Router;
  limiter: RateLimiter;
  budget: BudgetTracker;
  cache: ResponseCache;
  cacheKeyOptions: CacheKeyOptions;
  logs: LogSink;
  prices: Record<string, Price>;
  health: HealthDeps;
  metrics?: Metrics;
  logPrompts?: boolean;
  logger: Logger;
}

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(express.json({ limit: '1mb' }));
  app.use(healthRoutes({ ...deps.health, metrics: deps.metrics }));
  app.use(chatRoutes(deps));
  app.use(notFound());
  app.use(errorHandler(deps.logger));
  return app;
}
