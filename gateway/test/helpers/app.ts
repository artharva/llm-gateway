import { createApp } from '../../src/app';
import type { GatewayConfig } from '../../src/config/gatewayConfig';
import { MemoryKeyStore, type NewApiKey } from '../../src/db/keyStore';
import { BudgetTracker } from '../../src/limits/BudgetTracker';
import { RateLimiter } from '../../src/limits/RateLimiter';
import { silentLogger } from '../../src/logger';
import { KeyResolver } from '../../src/middleware/auth';
import { Router } from '../../src/router/Router';
import { fakeConfig, FakeProvider, instantRetries, memoryBreakers, providerMap } from './fakes';

/** The whole app wired with in-memory parts, for route-level unit tests. */
export async function testApp(
  opts: { key?: Partial<NewApiKey>; config?: GatewayConfig; now?: () => number } = {},
) {
  const now = opts.now ?? Date.now;
  const store = new MemoryKeyStore();
  const { key, record } = await store.create({ name: 'test', ...opts.key });
  const primary = new FakeProvider('primary');
  const backup = new FakeProvider('backup');
  const config = opts.config ?? fakeConfig({ fast: { chain: ['primary', 'backup'] } });
  const resolver = new KeyResolver(store, 0);
  const router = new Router(config, providerMap(primary, backup), memoryBreakers(now), {
    ...instantRetries,
    now,
  });
  const limiter = new RateLimiter(null, { now });
  const budget = new BudgetTracker(null, { now });
  const app = createApp({ keys: resolver, router, limiter, budget, logger: silentLogger });
  return { app, key, record, store, primary, backup, limiter, budget, resolver };
}

export const chatBody = { model: 'fast', messages: [{ role: 'user', content: 'hi' }] };
