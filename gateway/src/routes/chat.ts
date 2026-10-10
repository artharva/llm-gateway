import { Router as ExpressRouter } from 'express';
import { cacheKey, cachePolicy, parseCacheMode, type CacheKeyOptions } from '../cache/cacheKey';
import type { ResponseCache } from '../cache/ResponseCache';
import { ctx } from '../context';
import type { BudgetTracker } from '../limits/BudgetTracker';
import type { RateLimiter } from '../limits/RateLimiter';
import { requireApiKey, type KeyResolver } from '../middleware/auth';
import { enforceBudget, rateLimit } from '../middleware/limits';
import { redactPii } from '../middleware/privacy';
import { logRequests } from '../middleware/requestLog';
import type { Price } from '../logging/cost';
import type { LogSink } from '../logging/requestLog';
import type { Metrics } from '../metrics/metrics';
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
  logs: LogSink;
  prices: Record<string, Price>;
  metrics?: Metrics;
  logPrompts?: boolean;
}

/**
 * The request path, one middleware per step:
 * log -> auth -> validation -> rate limit -> budget -> PII redaction -> cache -> route to a provider.
 * A cache hit returns early and never reaches a provider.
 */
export function chatRoutes(deps: ChatRouteDeps): ExpressRouter {
  const routes = ExpressRouter();
  routes.post(
    '/v1/chat',
    logRequests(deps.logs, {
      prices: deps.prices,
      metrics: deps.metrics,
      isKnownModel: (alias) => deps.router.hasAlias(alias),
    }),
    requireApiKey(deps.keys),
    validateBody(chatRequestSchema),
    rateLimit(deps.limiter),
    enforceBudget(deps.budget),
    redactPii({ metrics: deps.metrics, logPrompts: deps.logPrompts }),
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
          c.cacheStatus = 'HIT';
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
      c.cacheStatus = policy.read ? 'MISS' : 'BYPASS';
      res.setHeader('X-Cache', c.cacheStatus);

      const routed = await deps.router.route(body.model, body);
      // Lets clients (and the load tests) split latency into provider time and gateway overhead.
      res.setHeader('Server-Timing', `provider;dur=${routed.providerMs}`);
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
