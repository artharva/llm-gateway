import { Router as ExpressRouter } from 'express';
import { cacheKey, cachePolicy, parseCacheMode, type CacheKeyOptions } from '../cache/cacheKey';
import type { ResponseCache } from '../cache/ResponseCache';
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
  cache: ResponseCache;
  cacheKeyOptions: CacheKeyOptions;
}

/**
 * The request path, one middleware per step:
 * auth -> validation -> rate limit -> budget -> cache -> route to a provider.
 * A cache hit returns early and never reaches a provider.
 */
export function chatRoutes(deps: ChatRouteDeps): ExpressRouter {
  const routes = ExpressRouter();
  routes.post(
    '/v1/chat',
    requireApiKey(deps.keys),
    validateBody(chatRequestSchema),
    rateLimit(deps.limiter),
    enforceBudget(deps.budget),
    async (req, res) => {
      const body = res.locals.body as ChatRequest;
      const c = ctx(res);
      c.modelAlias = body.model;

      const policy = cachePolicy(body, parseCacheMode(req.get('x-gateway-cache')));
      const key = cacheKey(body, deps.cacheKeyOptions, c.apiKey!.id);
      if (policy.read) {
        const hit = await deps.cache.get(key);
        if (hit) {
          c.cacheHit = true;
          c.provider = hit.provider;
          res.setHeader('X-Cache', 'HIT');
          // A hit costs nothing, so it reports (and bills) zero tokens.
          const response: ChatResponse = {
            text: hit.text,
            usage: { input_tokens: 0, output_tokens: 0 },
            provider: hit.provider,
            latency_ms: c.elapsedMs(),
          };
          res.json(response);
          return;
        }
      }
      res.setHeader('X-Cache', policy.read ? 'MISS' : 'BYPASS');

      const routed = await deps.router.route(body.model, body);
      c.provider = routed.provider;
      c.attempts = routed.attempts;
      c.fallbackUsed = routed.fallbackUsed;
      c.inputTokens = routed.result.usage.input_tokens;
      c.outputTokens = routed.result.usage.output_tokens;
      await deps.budget.record(c.apiKey!.id, c.inputTokens + c.outputTokens);
      if (policy.write) {
        await deps.cache.set(key, {
          text: routed.result.text,
          usage: routed.result.usage,
          provider: routed.provider,
        });
      }
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
