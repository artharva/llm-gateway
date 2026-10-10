import { ProviderError } from '../../src/providers/errors';
import { MemoryBreakerStore } from '../../src/reliability/CircuitBreaker';
import { backoffDelay, isRetryable, retry } from '../../src/reliability/retry';
import { withTimeout } from '../../src/reliability/timeout';
import { breakerContract } from '../helpers/breakerContract';
import { testBreakerSettings } from '../helpers/fakes';

const transient = () => new ProviderError('p', 'provider_unavailable', '503', true, 503);
const permanent = () => new ProviderError('p', 'provider_bad_request', '400', false, 400);
const policy = { maxRetries: 2, baseDelayMs: 100, maxDelayMs: 1000 };

describe('withTimeout', () => {
  it('returns the value when fn finishes in time', async () => {
    await expect(withTimeout('p', 100, async () => 'ok')).resolves.toBe('ok');
  });

  it('rejects with a retryable timeout and aborts the signal', async () => {
    let signal: AbortSignal | undefined;
    const err = await withTimeout('p', 20, (s) => {
      signal = s;
      return new Promise(() => undefined); // never settles, like a hung provider
    }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'timeout', retryable: true, provider: 'p' });
    expect(signal?.aborted).toBe(true);
  });
});

describe('retry', () => {
  const noSleep = { sleep: async () => undefined, random: () => 1 };

  it('retries transient errors up to maxRetries, then gives up', async () => {
    const fn = jest.fn(async () => {
      throw transient();
    });
    await expect(retry(fn, policy, noSleep)).rejects.toMatchObject({
      code: 'provider_unavailable',
    });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('returns as soon as an attempt succeeds', async () => {
    let n = 0;
    const result = await retry(
      async () => (++n < 2 ? Promise.reject(transient()) : 'done'),
      policy,
      noSleep,
    );
    expect(result).toBe('done');
    expect(n).toBe(2);
  });

  it('never retries errors that would fail the same way again', async () => {
    const fn = jest.fn(async () => {
      throw permanent();
    });
    await expect(retry(fn, policy, noSleep)).rejects.toMatchObject({
      code: 'provider_bad_request',
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(isRetryable(new Error('plain'))).toBe(false);
  });

  it('waits with exponential backoff and full jitter', async () => {
    const waits: number[] = [];
    await retry(
      async () => Promise.reject(transient()),
      { ...policy, maxRetries: 4 },
      {
        sleep: async (ms) => void waits.push(ms),
        random: () => 0.999,
      },
    ).catch(() => undefined);
    expect(waits).toEqual([99, 199, 399, 799]);
    expect(backoffDelay(10, policy, () => 0.999)).toBe(999); // capped at maxDelayMs
    expect(backoffDelay(3, policy, () => 0)).toBe(0); // full jitter can be zero
  });

  it('honours Retry-After but skips a retry that asks for too long', async () => {
    const waits: number[] = [];
    const shortWait = new ProviderError('p', 'provider_rate_limited', '429', true, 429, 500);
    let n = 0;
    await retry(async () => (n++ === 0 ? Promise.reject(shortWait) : 'ok'), policy, {
      sleep: async (ms) => void waits.push(ms),
      random: () => 0,
    });
    expect(waits).toEqual([500]);

    const longWait = new ProviderError('p', 'provider_rate_limited', '429', true, 429, 60_000);
    const fn = jest.fn(async () => Promise.reject(longWait));
    await expect(retry(fn, policy, noSleep)).rejects.toBe(longWait);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not start a retry that would pass the deadline', async () => {
    const fn = jest.fn(async () => Promise.reject(transient()));
    await expect(
      retry(fn, policy, { ...noSleep, now: () => 1000, deadline: 1050 }),
    ).rejects.toBeDefined();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('MemoryBreakerStore', () => {
  breakerContract(async () => new MemoryBreakerStore(testBreakerSettings));
});
