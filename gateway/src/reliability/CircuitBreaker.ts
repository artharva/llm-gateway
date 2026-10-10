import crypto from 'node:crypto';
import type Redis from 'ioredis';
import type { Logger } from '../logger';
import { Failover } from '../redis/failover';
import { ALLOW_LUA, FAILURE_LUA, SUCCESS_LUA } from './breakerScripts';

export type BreakerState = 'closed' | 'open' | 'half_open';

export interface BreakerSettings {
  /** Failures inside windowMs that open the breaker. */
  failureThreshold: number;
  windowMs: number;
  /** How long an open breaker skips the provider before letting one trial call through. */
  cooldownMs: number;
  /** A half-open trial that never reports back is given up after this long. */
  trialTimeoutMs: number;
}

export interface BreakerSnapshot {
  provider: string;
  state: BreakerState;
  recentFailures: number;
  openedAt: number | null;
}

/** Where breaker state lives. Both stores implement the same state machine. */
export interface BreakerStore {
  allow(name: string, now: number): Promise<boolean>;
  success(name: string, now: number): Promise<BreakerState>;
  failure(name: string, now: number): Promise<BreakerState>;
  snapshot(name: string, now: number): Promise<BreakerSnapshot>;
}

interface MemoryEntry {
  state: BreakerState;
  failures: number[];
  openedAt: number | null;
  trialAt: number | null;
}

/** Per-process state: used when Redis is unavailable, and in unit tests. */
export class MemoryBreakerStore implements BreakerStore {
  private readonly entries = new Map<string, MemoryEntry>();

  constructor(private readonly settings: BreakerSettings) {}

  private entry(name: string): MemoryEntry {
    let e = this.entries.get(name);
    if (!e) {
      e = { state: 'closed', failures: [], openedAt: null, trialAt: null };
      this.entries.set(name, e);
    }
    return e;
  }

  async allow(name: string, now: number): Promise<boolean> {
    const e = this.entry(name);
    if (e.state === 'closed') return true;
    if (e.state === 'open') {
      if (now - (e.openedAt ?? 0) < this.settings.cooldownMs) return false;
      e.state = 'half_open';
      e.trialAt = now;
      return true;
    }
    if (now - (e.trialAt ?? 0) >= this.settings.trialTimeoutMs) {
      e.trialAt = now;
      return true;
    }
    return false;
  }

  async success(name: string): Promise<BreakerState> {
    const e = this.entry(name);
    if (e.state === 'half_open') {
      Object.assign(e, { state: 'closed', failures: [], openedAt: null, trialAt: null });
    }
    return e.state;
  }

  async failure(name: string, now: number): Promise<BreakerState> {
    const e = this.entry(name);
    if (e.state === 'half_open') {
      Object.assign(e, { state: 'open', openedAt: now, trialAt: null });
      return 'open';
    }
    if (e.state === 'open') return 'open';
    e.failures = e.failures.filter((t) => t > now - this.settings.windowMs);
    e.failures.push(now);
    if (e.failures.length >= this.settings.failureThreshold) {
      Object.assign(e, { state: 'open', openedAt: now, failures: [] });
    }
    return e.state;
  }

  async snapshot(name: string, now: number): Promise<BreakerSnapshot> {
    const e = this.entry(name);
    return {
      provider: name,
      state: e.state,
      recentFailures: e.failures.filter((t) => t > now - this.settings.windowMs).length,
      openedAt: e.openedAt,
    };
  }
}

/**
 * Shared state in Redis, so every gateway instance sees the same breaker:
 * when one instance learns a provider is down, the others stop calling it too.
 */
export class RedisBreakerStore implements BreakerStore {
  constructor(
    private readonly redis: Redis,
    private readonly settings: BreakerSettings,
    private readonly prefix = 'breaker',
  ) {}

  private keys(name: string): [string, string] {
    return [`${this.prefix}:${name}`, `${this.prefix}:${name}:fails`];
  }

  async allow(name: string, now: number): Promise<boolean> {
    const [hash, fails] = this.keys(name);
    const ok = await this.redis.eval(
      ALLOW_LUA,
      2,
      hash,
      fails,
      now,
      this.settings.cooldownMs,
      this.settings.trialTimeoutMs,
    );
    return ok === 1;
  }

  async success(name: string): Promise<BreakerState> {
    const [hash, fails] = this.keys(name);
    return (await this.redis.eval(SUCCESS_LUA, 2, hash, fails)) as BreakerState;
  }

  async failure(name: string, now: number): Promise<BreakerState> {
    const [hash, fails] = this.keys(name);
    const member = `${now}-${crypto.randomUUID()}`;
    return (await this.redis.eval(
      FAILURE_LUA,
      2,
      hash,
      fails,
      now,
      this.settings.failureThreshold,
      this.settings.windowMs,
      member,
    )) as BreakerState;
  }

  async snapshot(name: string, now: number): Promise<BreakerSnapshot> {
    const [hash, fails] = this.keys(name);
    const [fields, recent] = await Promise.all([
      this.redis.hgetall(hash),
      this.redis.zcount(fails, now - this.settings.windowMs, '+inf'),
    ]);
    return {
      provider: name,
      state: (fields.state as BreakerState | undefined) ?? 'closed',
      recentFailures: recent,
      openedAt: fields.opened_at ? Number(fields.opened_at) : null,
    };
  }
}

export type TransitionListener = (provider: string, from: BreakerState, to: BreakerState) => void;

/**
 * One breaker per provider. Uses Redis when it is up and falls back to the
 * in-memory store when it is not.
 */
export class CircuitBreakers {
  private readonly memory: MemoryBreakerStore;
  private readonly failover: Failover;
  private readonly lastKnown = new Map<string, BreakerState>();

  constructor(
    readonly settings: BreakerSettings,
    private readonly redisStore: BreakerStore | null,
    private readonly opts: {
      now?: () => number;
      logger?: Logger;
      onTransition?: TransitionListener;
      onFallback?: (c: string) => void;
    } = {},
  ) {
    this.memory = new MemoryBreakerStore(settings);
    this.failover = new Failover('circuit-breaker', opts.logger, opts.onFallback);
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  private call<T>(op: (store: BreakerStore) => Promise<T>): Promise<T> {
    if (!this.redisStore) return op(this.memory);
    return this.failover.run(
      () => op(this.redisStore!),
      () => op(this.memory),
    );
  }

  private record(provider: string, to: BreakerState): void {
    const from = this.lastKnown.get(provider) ?? 'closed';
    this.lastKnown.set(provider, to);
    if (from === to) return;
    this.opts.logger?.warn({ provider, from, to }, 'circuit breaker changed state');
    this.opts.onTransition?.(provider, from, to);
  }

  async allow(provider: string): Promise<boolean> {
    const ok = await this.call((s) => s.allow(provider, this.now()));
    if (ok && this.lastKnown.get(provider) === 'open') this.record(provider, 'half_open');
    return ok;
  }

  async success(provider: string): Promise<void> {
    this.record(provider, await this.call((s) => s.success(provider, this.now())));
  }

  async failure(provider: string): Promise<void> {
    this.record(provider, await this.call((s) => s.failure(provider, this.now())));
  }

  snapshot(provider: string): Promise<BreakerSnapshot> {
    return this.call((s) => s.snapshot(provider, this.now()));
  }
}
