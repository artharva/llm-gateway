import express from 'express';
import type { BudgetTracker } from './limits/BudgetTracker';
import type { RateLimiter } from './limits/RateLimiter';
import type { KeyResolver } from './middleware/auth';
import { errorHandler, notFound, requestId } from './middleware/errors';
import type { Logger } from './logger';
import type { Router } from './router/Router';
import { chatRoutes } from './routes/chat';
import { healthRoutes } from './routes/health';

export interface AppDeps {
  keys: KeyResolver;
  router: Router;
  limiter: RateLimiter;
  budget: BudgetTracker;
  logger: Logger;
}

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(express.json({ limit: '1mb' }));
  app.use(healthRoutes());
  app.use(chatRoutes(deps));
  app.use(notFound());
  app.use(errorHandler(deps.logger));
  return app;
}
