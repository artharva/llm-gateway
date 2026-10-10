/**
 * A provider call that failed. `retryable` says whether trying the same
 * provider again could help: timeouts, network errors, 429 and 5xx can;
 * a 400 or a bad API key will fail the same way every time.
 */
export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function codeForStatus(status: number): string {
  if (status === 429) return 'provider_rate_limited';
  if (status === 401 || status === 403) return 'provider_auth_failed';
  if (status >= 500) return 'provider_unavailable';
  return 'provider_bad_request';
}
