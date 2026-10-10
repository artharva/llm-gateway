import { Router as ExpressRouter } from 'express';
import { ctx } from '../context';
import type { BudgetTracker } from '../limits/BudgetTracker';
import type { RateLimiter } from '../limits/RateLimiter';
import { requireApiKey, type KeyResolver } from '../middleware/auth';
import { enforceBudget, rateLimit } from '../middleware/limits';
import { validateBody } from '../middleware/validate';
import type { Router } from '../router/Router';
import { chatRequestSchema, type ChatRequest, type ChatResponse } from '../types';

export interface ChatRouteDeps {
  keys: KeyResolver;
  router: Router;
  limiter: RateLimiter;
  budget: BudgetTracker;
}

/**
 * The request path, one middleware per step:
 * auth -> validation -> rate limit -> budget -> route to a provider.
 */
export function chatRoutes(deps: ChatRouteDeps): ExpressRouter {
  const routes = ExpressRouter();
  routes.post(
    '/v1/chat',
    requireApiKey(deps.keys),
    validateBody(chatRequestSchema),
    rateLimit(deps.limiter),
    enforceBudget(deps.budget),
    async (_req, res) => {
      const body = res.locals.body as ChatRequest;
      const c = ctx(res);
      c.modelAlias = body.model;
      const routed = await deps.router.route(body.model, body);
      c.provider = routed.provider;
      c.attempts = routed.attempts;
      c.fallbackUsed = routed.fallbackUsed;
      c.inputTokens = routed.result.usage.input_tokens;
      c.outputTokens = routed.result.usage.output_tokens;
      await deps.budget.record(c.apiKey!.id, c.inputTokens + c.outputTokens);
      const response: ChatResponse = {
        text: routed.result.text,
        usage: routed.result.usage,
        provider: routed.provider,
        latency_ms: c.elapsedMs(),
      };
      res.json(response);
    },
  );
  return routes;
}
