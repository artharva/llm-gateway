import type { RequestHandler } from 'express';
import { ctx } from '../context';
import { HttpError } from '../errors';
import type { BudgetTracker } from '../limits/BudgetTracker';
import type { RateLimiter } from '../limits/RateLimiter';

export function rateLimit(limiter: RateLimiter): RequestHandler {
  return async (_req, res, next) => {
    const key = ctx(res).apiKey!;
    const d = await limiter.take(key.id, key.ratePerMin, key.burst);
    res.setHeader('X-RateLimit-Limit', String(d.limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, d.remaining)));
    if (!d.allowed) {
      const seconds = Math.max(1, Math.ceil(d.retryAfterMs / 1000));
      throw new HttpError(
        429,
        'rate_limited',
        `Rate limit of ${d.limit} requests per minute exceeded`,
        { retry_after_seconds: seconds },
        { 'Retry-After': String(seconds) },
      );
    }
    next();
  };
}

export function enforceBudget(budget: BudgetTracker): RequestHandler {
  return async (_req, res, next) => {
    const key = ctx(res).apiKey!;
    const used = await budget.used(key.id);
    const remaining = Math.max(0, key.monthlyTokenBudget - used);
    res.setHeader('X-Token-Budget-Remaining', String(remaining));
    if (used >= key.monthlyTokenBudget) {
      const seconds = budget.secondsUntilReset();
      throw new HttpError(
        429,
        'budget_exceeded',
        `Monthly token budget of ${key.monthlyTokenBudget} is used up`,
        { used, budget: key.monthlyTokenBudget },
        { 'Retry-After': String(seconds) },
      );
    }
    next();
  };
}
