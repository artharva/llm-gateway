import request from 'supertest';
import type Redis from 'ioredis';
import { BudgetTracker, monthStart, nextMonthStart } from '../../src/limits/BudgetTracker';
import { RateLimiter } from '../../src/limits/RateLimiter';
import { bucketFor, takeToken, type BucketState } from '../../src/limits/tokenBucket';
import { chatBody, testApp } from '../helpers/app';

describe('token bucket maths', () => {
  const cfg = bucketFor(60, 10); // 1 token per second, bursts of 10

  it('starts full and allows a burst up to capacity', () => {
    let state: BucketState | undefined;
    const results = [];
    for (let i = 0; i < 11; i++) {
      const d = takeToken(state, cfg, 0);
      state = d.state;
      results.push(d.allowed);
    }
    expect(results.filter(Boolean)).toHaveLength(10);
    expect(results.at(-1)).toBe(false);
  });

  it('refills continuously at the per-minute rate', () => {
    let d = takeToken(undefined, cfg, 0);
    for (let i = 0; i < 9; i++) d = takeToken(d.state, cfg, 0);
    expect(d.remaining).toBe(0);
    expect(takeToken(d.state, cfg, 500).allowed).toBe(false);
    expect(takeToken(d.state, cfg, 1000).allowed).toBe(true);
    expect(takeToken(d.state, cfg, 3500).remaining).toBe(2); // 3.5 refilled, 1 taken
  });

  it('never refills past capacity', () => {
    const d = takeToken({ tokens: 3, ts: 0 }, cfg, 10 * 60_000);
    expect(d.remaining).toBe(9);
  });

  it('says how long until the next token', () => {
    const d = takeToken({ tokens: 0.25, ts: 0 }, cfg, 0);
    expect(d).toMatchObject({ allowed: false, retryAfterMs: 750 });
  });
});

describe('rate limiting on /v1/chat', () => {
  it('returns 429 with Retry-After once the burst is used, per key', async () => {
    let now = 1_000_000;
    const t = await testApp({ key: { ratePerMin: 60, burst: 3 }, now: () => now });
    const send = (key = t.key) =>
      request(t.app).post('/v1/chat').set('Authorization', `Bearer ${key}`).send(chatBody);

    for (let i = 0; i < 3; i++) expect((await send()).status).toBe(200);
    const limited = await send();
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('rate_limited');
    expect(limited.headers['retry-after']).toBe('1');
    expect(limited.headers['x-ratelimit-remaining']).toBe('0');

    // Another key has its own bucket.
    const other = await t.store.create({ name: 'other', ratePerMin: 60, burst: 3 });
    expect((await send(other.key)).status).toBe(200);

    now += 1000;
    expect((await send()).status).toBe(200);
  });

  it('falls back to an in-memory bucket when Redis errors', async () => {
    const broken = { eval: () => Promise.reject(new Error('ECONNREFUSED')) } as unknown as Redis;
    const fallbacks: string[] = [];
    const limiter = new RateLimiter(broken, { now: () => 0, onFallback: (c) => fallbacks.push(c) });
    const first = await limiter.take(1, 60, 1);
    const second = await limiter.take(1, 60, 1);
    expect([first.allowed, second.allowed]).toEqual([true, false]);
    expect(fallbacks).toEqual(['rate-limiter', 'rate-limiter']);
  });
});

describe('monthly token budgets', () => {
  const oct10 = Date.UTC(2026, 9, 10, 12);

  it('counts per calendar month in UTC', () => {
    expect(monthStart(oct10).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(nextMonthStart(Date.UTC(2026, 11, 31)).toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(new BudgetTracker(null, { now: () => oct10 }).counterKey(7)).toBe('usage:7:2026-10');
  });

  it('rejects requests once the budget is used, until next month', async () => {
    let now = oct10;
    const t = await testApp({
      key: { monthlyTokenBudget: 30, ratePerMin: 1000, burst: 1000 },
      now: () => now,
    });
    let n = 0;
    const send = () =>
      request(t.app)
        .post('/v1/chat')
        .set('Authorization', `Bearer ${t.key}`)
        .send({ ...chatBody, messages: [{ role: 'user', content: `question ${n++}` }] });

    // Each fake answer uses 15 tokens; distinct prompts so none is a cache hit.
    const first = await send();
    expect(first.status).toBe(200);
    expect(first.headers['x-token-budget-remaining']).toBe('30');
    expect((await send()).status).toBe(200);

    const over = await send();
    expect(over.status).toBe(429);
    expect(over.body.error).toMatchObject({
      code: 'budget_exceeded',
      details: { used: 30, budget: 30 },
    });
    expect(Number(over.headers['retry-after'])).toBe(22 * 24 * 3600 - 12 * 3600);
    expect(t.primary.calls).toHaveLength(2);

    now = Date.UTC(2026, 10, 1);
    expect((await send()).status).toBe(200);
  });

  it('a budget of 0 suspends a key', async () => {
    const t = await testApp({ key: { monthlyTokenBudget: 0 } });
    const res = await request(t.app)
      .post('/v1/chat')
      .set('Authorization', `Bearer ${t.key}`)
      .send(chatBody);
    expect(res.status).toBe(429);
  });
});
