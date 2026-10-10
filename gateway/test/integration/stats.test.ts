import type { Pool } from 'pg';
import { PgKeyStore } from '../../src/db/keyStore';
import { PgStats } from '../../src/db/statsRepo';
import { PgLogWriter, type RequestLogEntry } from '../../src/logging/requestLog';
import { freshDatabase } from '../helpers/db';
import { describeIntegration } from '../helpers/env';

describeIntegration('dashboard stats SQL', () => {
  let pool: Pool;
  let stats: PgStats;
  let a: number;
  let b: number;

  beforeAll(async () => {
    pool = await freshDatabase();
    stats = new PgStats(pool);
    const store = new PgKeyStore(pool);
    a = (await store.create({ name: 'chatbot' })).record.id;
    b = (await store.create({ name: 'summariser' })).record.id;

    const base = (o: Partial<RequestLogEntry>): RequestLogEntry => ({
      requestId: crypto.randomUUID(),
      ts: new Date(),
      apiKeyId: a,
      modelAlias: 'fast',
      provider: 'groq',
      status: 200,
      latencyMs: 100,
      inputTokens: 10,
      outputTokens: 10,
      costUsd: 0.001,
      cacheHit: false,
      fallbackUsed: false,
      attempts: 1,
      errorCode: null,
      piiRedacted: 0,
      prompt: null,
      ...o,
    });
    const writer = new PgLogWriter(pool);
    // 100 successes for key a with latencies 1..100 ms.
    for (let i = 1; i <= 100; i++) writer.write(base({ latencyMs: i }));
    // Key b: 10 cache hits, 5 fallbacks to gemini, 3 rate-limited, 2 failures.
    for (let i = 0; i < 10; i++)
      writer.write(
        base({
          apiKeyId: b,
          cacheHit: true,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          latencyMs: 2,
        }),
      );
    for (let i = 0; i < 5; i++)
      writer.write(base({ apiKeyId: b, provider: 'gemini', fallbackUsed: true, latencyMs: 300 }));
    for (let i = 0; i < 3; i++)
      writer.write(
        base({
          apiKeyId: b,
          provider: null,
          status: 429,
          errorCode: 'rate_limited',
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
        }),
      );
    for (let i = 0; i < 2; i++)
      writer.write(
        base({
          apiKeyId: b,
          provider: null,
          status: 502,
          errorCode: 'all_providers_failed',
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
        }),
      );
    // Outside every range.
    writer.write(base({ ts: new Date(Date.now() - 8 * 24 * 3600 * 1000) }));
    await writer.close();
  });
  afterAll(() => pool.end());

  it('overview counts and percentiles', async () => {
    const o = await stats.overview('1h');
    expect(o).toMatchObject({
      requests: 120,
      ok: 115,
      errors: 2,
      limited: 3,
      cache_hits: 10,
      fallbacks: 5,
    });
    expect(o.input_tokens).toBe(1050);
    expect(o.cost_usd).toBeCloseTo(0.105);
    // 115 successes: 100 at 1..100 ms, 10 at 2 ms, 5 at 300 ms.
    expect(o.p50_ms).toBe(48);
    expect(o.p95_ms).toBeGreaterThanOrEqual(96);
  });

  it('per-key usage, most expensive first', async () => {
    const keys = await stats.keys('1h');
    expect(keys.map((k) => [k.name, k.requests, k.errors, k.limited])).toEqual([
      ['chatbot', 100, 0, 0],
      ['summariser', 20, 2, 3],
    ]);
    expect(keys[0]!.cost_usd).toBeCloseTo(0.1);
    expect(keys[1]!.tokens).toBe(100);
  });

  it('per-provider usage leaves out cache hits and failures', async () => {
    const providers = await stats.providers('1h');
    expect(providers.map((p) => [p.provider, p.requests, p.fallbacks])).toEqual([
      ['groq', 100, 0],
      ['gemini', 5, 5],
    ]);
  });

  it('time series buckets the window', async () => {
    const points = await stats.timeseries('7d');
    expect(points.reduce((n, p) => n + p.requests, 0)).toBe(120);
    expect(points[0]).toEqual(
      expect.objectContaining({
        ts: expect.any(String),
        requests: expect.any(Number),
        p95_ms: expect.any(Number),
      }),
    );
    expect((await stats.overview('7d')).requests).toBe(120);
  });
});
