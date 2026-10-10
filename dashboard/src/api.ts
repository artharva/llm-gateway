export type Range = '15m' | '1h' | '24h' | '7d';

export interface Overview {
  requests: number;
  ok: number;
  errors: number;
  limited: number;
  cache_hits: number;
  fallbacks: number;
  p50_ms: number;
  p95_ms: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface TimePoint {
  ts: string;
  requests: number;
  ok: number;
  errors: number;
  limited: number;
  cache_hits: number;
  p50_ms: number | null;
  p95_ms: number | null;
  tokens: number;
  cost_usd: number;
}

export interface KeyStats {
  id: number;
  name: string;
  key_prefix: string;
  revoked: boolean;
  monthly_token_budget: number;
  used_this_month: number;
  requests: number;
  errors: number;
  limited: number;
  tokens: number;
  cost_usd: number;
}

export type BreakerState = 'closed' | 'half_open' | 'open';

export interface ProviderStats {
  provider: string;
  breaker: BreakerState;
  recent_failures: number;
  requests: number;
  fallbacks: number;
  p50_ms: number;
  p95_ms: number;
  tokens: number;
  cost_usd: number;
}

export interface ApiKey {
  id: number;
  name: string;
  owner: string | null;
  key_prefix: string;
  rate_per_min: number;
  burst: number;
  monthly_token_budget: number;
  created_at: string;
  revoked_at: string | null;
  used_this_month?: number;
}

export interface KeyInput {
  name?: string;
  owner?: string;
  rate_per_min?: number;
  burst?: number;
  monthly_token_budget?: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function createApi(token: string) {
  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, body?.error?.message ?? `HTTP ${res.status}`);
    return body as T;
  }
  const json = (method: string, body: unknown): RequestInit => ({
    method,
    body: JSON.stringify(body),
  });

  return {
    overview: (r: Range) => call<Overview>(`/admin/stats/overview?range=${r}`),
    timeseries: (r: Range) => call<TimePoint[]>(`/admin/stats/timeseries?range=${r}`),
    keyStats: (r: Range) => call<KeyStats[]>(`/admin/stats/keys?range=${r}`),
    providers: (r: Range) => call<ProviderStats[]>(`/admin/stats/providers?range=${r}`),
    listKeys: () => call<ApiKey[]>('/admin/keys'),
    createKey: (input: KeyInput) =>
      call<ApiKey & { key: string }>('/admin/keys', json('POST', input)),
    updateKey: (id: number, input: KeyInput) =>
      call<ApiKey>(`/admin/keys/${id}`, json('PATCH', input)),
    revokeKey: (id: number) => call<ApiKey>(`/admin/keys/${id}/revoke`, { method: 'POST' }),
  };
}

export type Api = ReturnType<typeof createApi>;
