import { ProviderError } from '../../src/providers/errors';
import { Router } from '../../src/router/Router';
import type { ProviderResult } from '../../src/types';
import {
  fakeConfig,
  FakeProvider,
  instantRetries,
  memoryBreakers,
  providerMap,
} from '../helpers/fakes';

const req = { messages: [{ role: 'user' as const, content: 'x' }], max_tokens: 5, temperature: 0 };
const down = () =>
  Promise.reject(new ProviderError('primary', 'provider_unavailable', '503', true, 503));

function setup(opts: { timeoutMs?: number; deadlineMs?: number } = {}) {
  let clock = 1_000_000;
  const primary = new FakeProvider('primary');
  const backup = new FakeProvider('backup');
  const config = fakeConfig(
    { fast: { chain: ['primary', 'backup'], timeoutMs: opts.timeoutMs ?? 1000 } },
    {
      requestDeadlineMs: opts.deadlineMs ?? 30_000,
      retry: { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 100 },
    },
  );
  const breakers = memoryBreakers(() => clock);
  const router = new Router(config, providerMap(primary, backup), breakers, {
    ...instantRetries,
    now: () => clock,
  });
  return { router, primary, backup, breakers, tick: (ms: number) => (clock += ms) };
}

describe('Router reliability', () => {
  it('retries a transient failure on the same provider before falling back', async () => {
    const { router, primary } = setup();
    let n = 0;
    primary.behaviour = async (): Promise<ProviderResult> => {
      if (n++ === 0) throw new ProviderError('primary', 'provider_unavailable', '503', true, 503);
      return { text: 'second try', usage: { input_tokens: 1, output_tokens: 1 } };
    };
    const routed = await router.route('fast', req);
    expect(routed).toMatchObject({ provider: 'primary', attempts: 2, fallbackUsed: false });
  });

  it('falls back to the next provider when the first keeps failing', async () => {
    const { router, primary, backup } = setup();
    primary.behaviour = down;
    const routed = await router.route('fast', req);
    expect(routed).toMatchObject({ provider: 'backup', attempts: 4, fallbackUsed: true });
    expect(primary.calls).toHaveLength(3); // first try + 2 retries
    expect(backup.calls).toHaveLength(1);
  });

  it('does not retry a bad request but still tries the fallback', async () => {
    const { router, primary } = setup();
    primary.behaviour = () =>
      Promise.reject(new ProviderError('primary', 'provider_bad_request', '400', false, 400));
    const routed = await router.route('fast', req);
    expect(primary.calls).toHaveLength(1);
    expect(routed.provider).toBe('backup');
  });

  it('opens the breaker after repeated failures and then skips the provider entirely', async () => {
    const { router, primary, breakers } = setup();
    primary.behaviour = down;
    await router.route('fast', req); // 3 failures
    await router.route('fast', req); // 2 more: the 5th opens the breaker mid-retry
    expect((await breakers.snapshot('primary')).state).toBe('open');
    const callsBefore = primary.calls.length;
    const routed = await router.route('fast', req);
    expect(primary.calls.length).toBe(callsBefore);
    expect(routed).toMatchObject({ provider: 'backup', fallbackUsed: true, attempts: 1 });
  });

  it('sends one trial request after the cool-down and closes the breaker when it works', async () => {
    const { router, primary, breakers, tick } = setup();
    primary.behaviour = down;
    await router.route('fast', req);
    await router.route('fast', req);
    tick(20_000);
    primary.behaviour = async () => ({
      text: 'back',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const routed = await router.route('fast', req);
    expect(routed.provider).toBe('primary');
    expect((await breakers.snapshot('primary')).state).toBe('closed');
  });

  it('times out a hung provider and falls back', async () => {
    const { router, primary } = setup({ timeoutMs: 30 });
    primary.behaviour = () => new Promise(() => undefined);
    const routed = await router.route('fast', req);
    expect(routed.provider).toBe('backup');
  });

  it('does not count bad requests against the breaker', async () => {
    const { router, primary, breakers } = setup();
    primary.behaviour = () =>
      Promise.reject(new ProviderError('primary', 'provider_bad_request', '400', false, 400));
    for (let i = 0; i < 6; i++) await router.route('fast', req);
    expect((await breakers.snapshot('primary')).state).toBe('closed');
  });

  it('returns 502 listing every failure when the whole chain fails', async () => {
    const { router, primary, backup } = setup();
    primary.behaviour = down;
    backup.behaviour = () =>
      Promise.reject(new ProviderError('backup', 'provider_auth_failed', '401', false, 401));
    await expect(router.route('fast', req)).rejects.toMatchObject({
      status: 502,
      code: 'all_providers_failed',
      details: {
        failures: [
          { provider: 'primary', code: 'provider_unavailable' },
          { provider: 'backup', code: 'provider_auth_failed' },
        ],
      },
    });
  });

  it('returns 503 with Retry-After when every breaker is open', async () => {
    const { router, primary, backup, breakers } = setup();
    primary.behaviour = down;
    backup.behaviour = down;
    for (let i = 0; i < 5; i++) {
      await breakers.failure('primary');
      await breakers.failure('backup');
    }
    await expect(router.route('fast', req)).rejects.toMatchObject({
      status: 503,
      code: 'all_circuits_open',
      headers: { 'Retry-After': '20' },
    });
  });

  it('gives up with 504 once the request deadline has passed', async () => {
    const { router, primary, tick } = setup({ deadlineMs: 100 });
    primary.behaviour = async () => {
      tick(150);
      throw new ProviderError('primary', 'provider_unavailable', '503', true, 503);
    };
    await expect(router.route('fast', req)).rejects.toMatchObject({
      status: 504,
      code: 'gateway_timeout',
    });
  });
});
