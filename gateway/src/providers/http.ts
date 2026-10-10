import { codeForStatus, isRetryableStatus, ProviderError } from './errors';

/** POST JSON and parse JSON, turning every failure into a ProviderError. */
export async function postJson<T>(
  provider: string,
  url: string,
  body: unknown,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  const res = await send(provider, url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal,
  });
  try {
    return (await res.json()) as T;
  } catch {
    throw new ProviderError(
      provider,
      'invalid_response',
      'response was not JSON',
      true,
      res.status,
    );
  }
}

/** GET a URL and report whether it answered 2xx; used by health checks. */
export async function isReachable(
  url: string,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const res = await fetch(url, { headers, signal: signal ?? AbortSignal.timeout(3000) });
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

async function send(provider: string, url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (init.signal?.aborted) {
      throw new ProviderError(provider, 'timeout', 'request timed out', true);
    }
    const cause = (err as { cause?: { code?: string } }).cause?.code;
    throw new ProviderError(provider, 'network_error', cause ?? (err as Error).message, true);
  }
  if (!res.ok) {
    const snippet = (await res.text().catch(() => '')).slice(0, 200);
    throw new ProviderError(
      provider,
      codeForStatus(res.status),
      `HTTP ${res.status}${snippet ? `: ${snippet}` : ''}`,
      isRetryableStatus(res.status),
      res.status,
      parseRetryAfter(res.headers.get('retry-after')),
    );
  }
  return res;
}

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}
