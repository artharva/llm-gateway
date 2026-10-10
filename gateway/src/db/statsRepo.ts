import type { Pool } from 'pg';

export const RANGES = {
  '15m': { interval: '15 minutes', bucket: '30 seconds' },
  '1h': { interval: '1 hour', bucket: '1 minute' },
  '24h': { interval: '24 hours', bucket: '15 minutes' },
  '7d': { interval: '7 days', bucket: '2 hours' },
} as const;
export type Range = keyof typeof RANGES;

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

export interface KeyUsage {
  id: number;
  name: string;
  key_prefix: string;
  revoked: boolean;
  monthly_token_budget: number;
  requests: number;
  errors: number;
  limited: number;
  tokens: number;
  cost_usd: number;
}

export interface ProviderUsage {
  provider: string;
  requests: number;
  fallbacks: number;
  p50_ms: number;
  p95_ms: number;
  tokens: number;
  cost_usd: number;
}

export interface StatsSource {
  overview(range: Range): Promise<Overview>;
  timeseries(range: Range): Promise<TimePoint[]>;
  keys(range: Range): Promise<KeyUsage[]>;
  providers(range: Range): Promise<ProviderUsage[]>;
}

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v)));

/**
 * Dashboard numbers straight from request_logs. "errors" are 5xx (the
 * gateway failed the client); 429s are counted separately as "limited".
 * Latency percentiles only cover successful requests.
 */
export class PgStats implements StatsSource {
  constructor(private readonly pool: Pool) {}

  async overview(range: Range): Promise<Overview> {
    const { rows } = await this.pool.query(
      `SELECT count(*) AS requests,
              count(*) FILTER (WHERE status = 200) AS ok,
              count(*) FILTER (WHERE status >= 500) AS errors,
              count(*) FILTER (WHERE status = 429) AS limited,
              count(*) FILTER (WHERE cache_hit) AS cache_hits,
              count(*) FILTER (WHERE fallback_used) AS fallbacks,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE status = 200) AS p50,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE status = 200) AS p95,
              COALESCE(sum(input_tokens), 0) AS input_tokens,
              COALESCE(sum(output_tokens), 0) AS output_tokens,
              COALESCE(sum(cost_usd), 0) AS cost
         FROM request_logs
        WHERE ts >= now() - $1::interval`,
      [RANGES[range].interval],
    );
    const r = rows[0];
    return {
      requests: num(r.requests),
      ok: num(r.ok),
      errors: num(r.errors),
      limited: num(r.limited),
      cache_hits: num(r.cache_hits),
      fallbacks: num(r.fallbacks),
      p50_ms: Math.round(num(r.p50)),
      p95_ms: Math.round(num(r.p95)),
      input_tokens: num(r.input_tokens),
      output_tokens: num(r.output_tokens),
      cost_usd: num(r.cost),
    };
  }

  async timeseries(range: Range): Promise<TimePoint[]> {
    const { rows } = await this.pool.query(
      `SELECT date_bin($2::interval, ts, TIMESTAMPTZ '2000-01-01') AS bucket,
              count(*) AS requests,
              count(*) FILTER (WHERE status = 200) AS ok,
              count(*) FILTER (WHERE status >= 500) AS errors,
              count(*) FILTER (WHERE status = 429) AS limited,
              count(*) FILTER (WHERE cache_hit) AS cache_hits,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE status = 200) AS p50,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE status = 200) AS p95,
              COALESCE(sum(input_tokens + output_tokens), 0) AS tokens,
              COALESCE(sum(cost_usd), 0) AS cost
         FROM request_logs
        WHERE ts >= now() - $1::interval
        GROUP BY 1
        ORDER BY 1`,
      [RANGES[range].interval, RANGES[range].bucket],
    );
    return rows.map((r) => ({
      ts: (r.bucket as Date).toISOString(),
      requests: num(r.requests),
      ok: num(r.ok),
      errors: num(r.errors),
      limited: num(r.limited),
      cache_hits: num(r.cache_hits),
      p50_ms: numOrNull(r.p50),
      p95_ms: numOrNull(r.p95),
      tokens: num(r.tokens),
      cost_usd: num(r.cost),
    }));
  }

  async keys(range: Range): Promise<KeyUsage[]> {
    const { rows } = await this.pool.query(
      `SELECT k.id, k.name, k.key_prefix, k.monthly_token_budget, k.revoked_at IS NOT NULL AS revoked,
              count(l.id) AS requests,
              count(l.id) FILTER (WHERE l.status >= 500) AS errors,
              count(l.id) FILTER (WHERE l.status = 429) AS limited,
              COALESCE(sum(l.input_tokens + l.output_tokens), 0) AS tokens,
              COALESCE(sum(l.cost_usd), 0) AS cost
         FROM api_keys k
         LEFT JOIN request_logs l ON l.api_key_id = k.id AND l.ts >= now() - $1::interval
        GROUP BY k.id
        ORDER BY cost DESC, requests DESC, k.id`,
      [RANGES[range].interval],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      key_prefix: r.key_prefix,
      revoked: r.revoked,
      monthly_token_budget: num(r.monthly_token_budget),
      requests: num(r.requests),
      errors: num(r.errors),
      limited: num(r.limited),
      tokens: num(r.tokens),
      cost_usd: num(r.cost),
    }));
  }

  async providers(range: Range): Promise<ProviderUsage[]> {
    const { rows } = await this.pool.query(
      `SELECT provider,
              count(*) AS requests,
              count(*) FILTER (WHERE fallback_used) AS fallbacks,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95,
              COALESCE(sum(input_tokens + output_tokens), 0) AS tokens,
              COALESCE(sum(cost_usd), 0) AS cost
         FROM request_logs
        WHERE ts >= now() - $1::interval AND provider IS NOT NULL AND NOT cache_hit AND status = 200
        GROUP BY provider
        ORDER BY requests DESC`,
      [RANGES[range].interval],
    );
    return rows.map((r) => ({
      provider: r.provider,
      requests: num(r.requests),
      fallbacks: num(r.fallbacks),
      p50_ms: Math.round(num(r.p50)),
      p95_ms: Math.round(num(r.p95)),
      tokens: num(r.tokens),
      cost_usd: num(r.cost),
    }));
  }
}
