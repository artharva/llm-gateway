import type Redis from 'ioredis';
import type { Logger } from '../logger';
import { Failover } from '../redis/failover';

/** Returns tokens a key has already used since monthStart, from the durable log. */
export type UsageSeed = (keyId: number, monthStart: Date) => Promise<number>;

export interface BudgetOptions {
  now?: () => number;
  logger?: Logger;
  onFallback?: (component: string) => void;
  /** Rebuilds a month's counter from Postgres if Redis lost it (restart, flush). */
  seed?: UsageSeed;
}

const FORTY_DAYS_S = 40 * 24 * 3600;

export function monthStart(now: number): Date {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function nextMonthStart(now: number): Date {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

/**
 * Tokens used per key per calendar month (UTC), kept in a Redis counter.
 * The check happens before the provider call and usage is added after it,
 * so concurrent requests can overshoot a budget by at most what they use.
 */
export class BudgetTracker {
  private readonly memory = new Map<string, number>();
  private readonly failover: Failover;
  private readonly now: () => number;

  constructor(
    private readonly redis: Redis | null,
    private readonly opts: BudgetOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.failover = new Failover('budget', opts.logger, opts.onFallback);
  }

  counterKey(keyId: number, now = this.now()): string {
    return `usage:${keyId}:${monthStart(now).toISOString().slice(0, 7)}`;
  }

  async used(keyId: number): Promise<number> {
    const key = this.counterKey(keyId);
    const local = () => this.memory.get(key) ?? 0;
    if (!this.redis) return local();
    const redis = this.redis;
    return this.failover.run(async () => {
      const value = await redis.get(key);
      if (value !== null) return Number(value);
      if (!this.opts.seed) return 0;
      const seeded = await this.opts.seed(keyId, monthStart(this.now()));
      // NX: if a request recorded usage meanwhile, keep its value.
      await redis.set(key, seeded, 'EX', FORTY_DAYS_S, 'NX');
      return Number((await redis.get(key)) ?? seeded);
    }, local);
  }

  async record(keyId: number, tokens: number): Promise<void> {
    if (tokens <= 0) return;
    const key = this.counterKey(keyId);
    const local = () => {
      this.memory.set(key, (this.memory.get(key) ?? 0) + tokens);
    };
    if (!this.redis) return local();
    const redis = this.redis;
    await this.failover.run(async () => {
      await redis.multi().incrby(key, tokens).expire(key, FORTY_DAYS_S).exec();
    }, local);
  }

  /** Seconds until the budget resets at the start of next month (UTC). */
  secondsUntilReset(): number {
    return Math.ceil((nextMonthStart(this.now()).getTime() - this.now()) / 1000);
  }
}
