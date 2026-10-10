import { ProviderError } from '../providers/errors';

/**
 * Runs fn with an AbortSignal that fires after ms. The adapter's fetch is
 * cancelled, and the race guarantees we return on time even if it is not.
 */
export async function withTimeout<T>(
  provider: string,
  ms: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => {
        controller.abort();
        reject(new ProviderError(provider, 'timeout', `no answer within ${ms} ms`, true));
      },
      Math.max(0, ms),
    );
  });
  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
