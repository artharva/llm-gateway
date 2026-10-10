import type { BreakerStore } from '../../src/reliability/CircuitBreaker';
import { testBreakerSettings } from './fakes';

/**
 * The circuit breaker state machine, written once and run against both the
 * in-memory store (unit) and the Redis Lua store (integration).
 */
export function breakerContract(makeStore: () => Promise<BreakerStore>) {
  const { failureThreshold, windowMs, cooldownMs, trialTimeoutMs } = testBreakerSettings;
  let store: BreakerStore;
  let name = 'p';
  let counter = 0;

  beforeEach(async () => {
    store = await makeStore();
    name = `provider-${++counter}-${Date.now()}`;
  });

  async function failTimes(n: number, at: number) {
    let state = 'closed';
    for (let i = 0; i < n; i++) state = await store.failure(name, at + i);
    return state;
  }

  it('starts closed and allows calls', async () => {
    expect(await store.allow(name, 0)).toBe(true);
    expect((await store.snapshot(name, 0)).state).toBe('closed');
  });

  it(`opens after ${failureThreshold} failures inside the window`, async () => {
    expect(await failTimes(failureThreshold - 1, 1000)).toBe('closed');
    expect(await store.failure(name, 1100)).toBe('open');
    expect(await store.allow(name, 1200)).toBe(false);
    expect(await store.snapshot(name, 1200)).toMatchObject({ state: 'open', openedAt: 1100 });
  });

  it('forgets failures older than the window', async () => {
    await failTimes(failureThreshold - 1, 1000);
    expect(await store.failure(name, 1000 + windowMs + 10)).toBe('closed');
    expect((await store.snapshot(name, 1000 + windowMs + 10)).recentFailures).toBe(1);
  });

  it('lets exactly one trial through after the cool-down (half-open)', async () => {
    await failTimes(failureThreshold, 1000);
    const later = 1000 + failureThreshold + cooldownMs;
    expect(await store.allow(name, later - 10)).toBe(false);
    expect(await store.allow(name, later)).toBe(true);
    expect((await store.snapshot(name, later)).state).toBe('half_open');
    expect(await store.allow(name, later + 1)).toBe(false);
  });

  it('closes when the trial succeeds', async () => {
    await failTimes(failureThreshold, 1000);
    const later = 1000 + failureThreshold + cooldownMs;
    await store.allow(name, later);
    expect(await store.success(name, later + 5)).toBe('closed');
    expect(await store.allow(name, later + 6)).toBe(true);
    expect((await store.snapshot(name, later + 6)).recentFailures).toBe(0);
  });

  it('reopens and restarts the cool-down when the trial fails', async () => {
    await failTimes(failureThreshold, 1000);
    const later = 1000 + failureThreshold + cooldownMs;
    await store.allow(name, later);
    expect(await store.failure(name, later + 5)).toBe('open');
    expect(await store.allow(name, later + 5 + cooldownMs - 1)).toBe(false);
    expect(await store.allow(name, later + 5 + cooldownMs)).toBe(true);
  });

  it('allows a new trial if the previous one never reported back', async () => {
    await failTimes(failureThreshold, 1000);
    const later = 1000 + failureThreshold + cooldownMs;
    await store.allow(name, later);
    expect(await store.allow(name, later + trialTimeoutMs - 1)).toBe(false);
    expect(await store.allow(name, later + trialTimeoutMs)).toBe(true);
  });

  it('ignores late failures while open', async () => {
    await failTimes(failureThreshold, 1000);
    expect(await store.failure(name, 1500)).toBe('open');
    expect((await store.snapshot(name, 1500)).openedAt).toBe(1000 + failureThreshold - 1);
  });
}
