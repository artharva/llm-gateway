import { createApp } from '../../src/app';
import { ResponseCache } from '../../src/cache/ResponseCache';
import type { GatewayConfig } from '../../src/config/gatewayConfig';
import { MemoryKeyStore, type NewApiKey } from '../../src/db/keyStore';
import type { StatsSource } from '../../src/db/statsRepo';
import { BudgetTracker } from '../../src/limits/BudgetTracker';
import { RateLimiter } from '../../src/limits/RateLimiter';
import { MemoryLogSink } from '../../src/logging/requestLog';
import { silentLogger } from '../../src/logger';
import { Metrics } from '../../src/metrics/metrics';
import { KeyResolver } from '../../src/middleware/auth';
import { Router } from '../../src/router/Router';
import { fakeConfig, FakeProvider, instantRetries, memoryBreakers, providerMap } from './fakes';

export interface TestAppOptions {
  key?: Partial<NewApiKey>;
  config?: GatewayConfig;
  now?: () => number;
  logPrompts?: boolean;
  stats?: StatsSource;
}

export const ADMIN_TOKEN = 'test-admin-token';

const emptyStats: StatsSource = {
  overview: async () => ({
    requests: 0,
    ok: 0,
    errors: 0,
    limited: 0,
    cache_hits: 0,
    fallbacks: 0,
    p50_ms: 0,
    p95_ms: 0,
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
  }),
  timeseries: async () => [],
  keys: async () => [],
  providers: async () => [],
};

/** The whole app wired with in-memory parts, for route-level unit tests. */
export async function testApp(opts: TestAppOptions = {}) {
  const now = opts.now ?? Date.now;
  const store = new MemoryKeyStore();
  const { key, record } = await store.create({ name: 'test', ...opts.key });
  const primary = new FakeProvider('primary');
  const backup = new FakeProvider('backup');
  const providers = providerMap(primary, backup);
  const config = opts.config ?? fakeConfig({ fast: { chain: ['primary', 'backup'] } });
  const breakers = memoryBreakers(now);
  const metrics = new Metrics();
  metrics.watchBreakers(breakers, [...providers.keys()]);
  const resolver = new KeyResolver(store, 0);
  const router = new Router(config, providers, breakers, {
    ...instantRetries,
    now,
    onProviderFailure: (provider, code) => metrics.providerFailures.inc({ provider, code }),
  });
  const limiter = new RateLimiter(null, { now });
  const budget = new BudgetTracker(null, { now });
  const cache = new ResponseCache(null, { ttlSeconds: config.cache.ttlSeconds, now });
  const logs = new MemoryLogSink();
  const app = createApp({
    keys: resolver,
    router,
    limiter,
    budget,
    cache,
    cacheKeyOptions: config.cache,
    logs,
    prices: { primary: { inputPer1M: 1, outputPer1M: 2 } },
    metrics,
    logPrompts: opts.logPrompts,
    health: { providers, breakers, checkPostgres: async () => true },
    admin: {
      adminToken: ADMIN_TOKEN,
      store,
      resolver,
      stats: opts.stats ?? emptyStats,
      budget,
      breakers,
      providerNames: [...providers.keys()],
    },
    logger: silentLogger,
  });
  return {
    app,
    key,
    record,
    store,
    primary,
    backup,
    router,
    limiter,
    budget,
    cache,
    logs,
    metrics,
    breakers,
    config,
  };
}

export const chatBody = { model: 'fast', messages: [{ role: 'user', content: 'hi' }] };
