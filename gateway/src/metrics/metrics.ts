import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from '@prometheus-io/client';
import type { BreakerState, CircuitBreakers } from '../reliability/CircuitBreaker';

const STATE_VALUE: Record<BreakerState, number> = { closed: 0, half_open: 1, open: 2 };

/** Prometheus metrics served at /metrics. */
export class Metrics {
  readonly registry = new Registry();

  readonly requests = new Counter({
    name: 'gateway_requests_total',
    help: 'Chat requests by HTTP status, provider and cache result',
    labelNames: ['status', 'provider', 'cache', 'model'],
    registers: [this.registry],
  });
  readonly duration = new Histogram({
    name: 'gateway_request_duration_seconds',
    help: 'Chat request latency',
    labelNames: ['cache'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [this.registry],
  });
  readonly tokens = new Counter({
    name: 'gateway_tokens_total',
    help: 'Tokens sent to and received from providers',
    labelNames: ['direction', 'provider'],
    registers: [this.registry],
  });
  readonly cost = new Counter({
    name: 'gateway_cost_usd_total',
    help: 'Estimated provider cost in USD',
    labelNames: ['provider'],
    registers: [this.registry],
  });
  readonly providerFailures = new Counter({
    name: 'gateway_provider_failures_total',
    help: 'Failed provider calls, including ones that were retried or fell back',
    labelNames: ['provider', 'code'],
    registers: [this.registry],
  });
  readonly fallbacks = new Counter({
    name: 'gateway_fallbacks_total',
    help: 'Requests answered by a provider other than the first in the chain',
    labelNames: ['model'],
    registers: [this.registry],
  });
  readonly limited = new Counter({
    name: 'gateway_limited_total',
    help: 'Requests rejected by the rate limiter or the budget',
    labelNames: ['reason'],
    registers: [this.registry],
  });
  readonly redactions = new Counter({
    name: 'gateway_pii_redactions_total',
    help: 'PII values masked before leaving the gateway',
    labelNames: ['type'],
    registers: [this.registry],
  });
  readonly redisFallbacks = new Counter({
    name: 'gateway_redis_fallback_total',
    help: 'Operations served from in-memory fallbacks because Redis failed',
    labelNames: ['component'],
    registers: [this.registry],
  });
  readonly logDrops = new Counter({
    name: 'gateway_log_rows_dropped_total',
    help: 'Request log rows dropped because Postgres was unavailable',
    registers: [this.registry],
  });

  private breakers?: CircuitBreakers;
  private providerNames: string[] = [];

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: 'gateway_' });
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    new Gauge({
      name: 'gateway_breaker_state',
      help: 'Circuit breaker state per provider: 0 closed, 1 half-open, 2 open',
      labelNames: ['provider'],
      registers: [this.registry],
      async collect() {
        if (!self.breakers) return;
        for (const name of self.providerNames) {
          const snap = await self.breakers.snapshot(name);
          this.set({ provider: name }, STATE_VALUE[snap.state]);
        }
      },
    });
  }

  /** Reports each provider's breaker state as a gauge, read at scrape time. */
  watchBreakers(breakers: CircuitBreakers, providerNames: string[]): void {
    this.breakers = breakers;
    this.providerNames = providerNames;
  }
}
