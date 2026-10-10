import { ProviderError } from '../providers/errors';

export interface RetryPolicy {
  /** Extra attempts after the first. */
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface RetryOptions {
  /** Absolute time (ms) after which no new attempt starts. */
  deadline?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onRetry?: (err: unknown, retryNumber: number, delayMs: number) => void;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Only failures that might succeed on a second try: timeouts, network errors, 429 and 5xx. */
export function isRetryable(err: unknown): boolean {
  return err instanceof ProviderError && err.retryable;
}

/**
 * Exponential backoff with full jitter: the wait before retry n is a random
 * value in [0, min(maxDelay, base * 2^n)]. Jitter spreads retries out so many
 * clients that failed together do not all retry at the same instant.
 */
export function backoffDelay(
  retryNumber: number,
  policy: RetryPolicy,
  random: () => number,
): number {
  const cap = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** retryNumber);
  return Math.floor(random() * cap);
}

export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  policy: RetryPolicy,
  opts: RetryOptions = {},
): Promise<T> {
  const now = opts.now ?? Date.now;
  const wait = opts.sleep ?? sleep;
  const random = opts.random ?? Math.random;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= policy.maxRetries || !isRetryable(err)) throw err;
      let delay = backoffDelay(attempt, policy, random);
      // Honour a provider's Retry-After, unless it asks for longer than we will wait:
      // then the next provider in the chain is the better bet.
      const retryAfter = err instanceof ProviderError ? err.retryAfterMs : undefined;
      if (retryAfter !== undefined) {
        if (retryAfter > policy.maxDelayMs) throw err;
        delay = Math.max(delay, retryAfter);
      }
      if (opts.deadline !== undefined && now() + delay >= opts.deadline) throw err;
      opts.onRetry?.(err, attempt + 1, delay);
      await wait(delay);
    }
  }
}
