import request from 'supertest';
import { estimateCost } from '../../src/logging/cost';
import { chatBody, testApp } from '../helpers/app';

const auth = (key: string) => ({ Authorization: `Bearer ${key}` });

describe('PII never leaves the gateway', () => {
  it('the provider receives masked text and the response says how many values were masked', async () => {
    const t = await testApp();
    const res = await request(t.app)
      .post('/v1/chat')
      .set(auth(t.key))
      .send({
        model: 'fast',
        messages: [{ role: 'user', content: 'Email ravi@example.com or call 9876543210' }],
      });
    expect(res.headers['x-pii-redacted']).toBe('2');
    expect(t.primary.calls[0]?.messages[0]?.content).toBe('Email [EMAIL] or call [PHONE]');
    const metrics = await t.metrics.registry.getSingleMetricAsString(
      'gateway_pii_redactions_total',
    );
    expect(metrics).toContain('type="EMAIL"} 1');
  });

  it('two prompts that differ only in PII share a cache entry', async () => {
    const t = await testApp();
    const send = (content: string) =>
      request(t.app)
        .post('/v1/chat')
        .set(auth(t.key))
        .send({ model: 'fast', messages: [{ role: 'user', content }] });
    await send('Write to a@x.com');
    const second = await send('Write to b@y.org');
    expect(second.headers['x-cache']).toBe('HIT');
  });
});

describe('request logging', () => {
  it('logs one row per request with tokens, cost, cache and fallback flags, but no prompt', async () => {
    const t = await testApp();
    await request(t.app).post('/v1/chat').set(auth(t.key)).send(chatBody);
    await request(t.app).post('/v1/chat').set(auth(t.key)).send(chatBody);
    const [miss, hit] = t.logs.entries;
    expect(miss).toMatchObject({
      apiKeyId: t.record.id,
      modelAlias: 'fast',
      provider: 'primary',
      status: 200,
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.00002, // 10 x $1/M + 5 x $2/M
      cacheHit: false,
      fallbackUsed: false,
      attempts: 1,
      errorCode: null,
      prompt: null,
    });
    expect(miss?.latencyMs).toEqual(expect.any(Number));
    expect(hit).toMatchObject({ cacheHit: true, inputTokens: 0, outputTokens: 0, costUsd: 0 });
    expect(JSON.stringify(t.logs.entries)).not.toContain('"hi"');
  });

  it('logs rejected requests with their error code', async () => {
    const t = await testApp();
    await request(t.app).post('/v1/chat').send(chatBody);
    await request(t.app).post('/v1/chat').set(auth(t.key)).send({ model: 'fast' });
    expect(t.logs.entries.map((e) => [e.status, e.errorCode, e.apiKeyId])).toEqual([
      [401, 'missing_api_key', null],
      [400, 'invalid_request', t.record.id],
    ]);
  });

  it('records fallback use', async () => {
    const t = await testApp();
    t.primary.behaviour = async () => {
      throw new (await import('../../src/providers/errors')).ProviderError(
        'primary',
        'provider_unavailable',
        'x',
        true,
        503,
      );
    };
    await request(t.app)
      .post('/v1/chat')
      .set(auth(t.key))
      .set('X-Gateway-Cache', 'bypass')
      .send(chatBody);
    expect(t.logs.entries[0]).toMatchObject({
      provider: 'backup',
      fallbackUsed: true,
      attempts: 4,
    });
  });

  it('with LOG_PROMPTS on, stores only the redacted prompt', async () => {
    const t = await testApp({ logPrompts: true });
    await request(t.app)
      .post('/v1/chat')
      .set(auth(t.key))
      .send({ model: 'fast', messages: [{ role: 'user', content: 'my mail is a@b.com' }] });
    expect(t.logs.entries[0]?.prompt).toBe('[{"role":"user","content":"my mail is [EMAIL]"}]');
  });
});

describe('cost estimates', () => {
  const prices = { groq: { inputPer1M: 0.05, outputPer1M: 0.08 } };
  it('uses the price table and treats unknown providers as free', () => {
    expect(estimateCost(prices, 'groq', 1_000_000, 500_000)).toBeCloseTo(0.09);
    expect(estimateCost(prices, 'groq', 120, 80)).toBe(0.000012);
    expect(estimateCost(prices, 'mystery', 1000, 1000)).toBe(0);
    expect(estimateCost(prices, undefined, 1000, 1000)).toBe(0);
  });
});

describe('/health and /metrics', () => {
  it('reports ok with each provider and its breaker', async () => {
    const t = await testApp();
    const res = await request(t.app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      checks: { postgres: 'up', redis: 'not_configured' },
      providers: [
        { name: 'primary', breaker: 'closed' },
        { name: 'backup', breaker: 'closed' },
      ],
    });
  });

  it('reports degraded when a breaker is open, and runs provider checks with ?deep=true', async () => {
    const t = await testApp();
    for (let i = 0; i < 5; i++) await t.breakers.failure('primary');
    t.backup.healthy = false;
    const res = await request(t.app).get('/health?deep=true');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.providers).toEqual([
      expect.objectContaining({ name: 'primary', breaker: 'open', reachable: true }),
      expect.objectContaining({ name: 'backup', breaker: 'closed', reachable: false }),
    ]);
  });

  it('serves Prometheus metrics, including breaker state and request counts', async () => {
    const t = await testApp();
    await request(t.app).post('/v1/chat').set(auth(t.key)).send(chatBody);
    for (let i = 0; i < 5; i++) await t.breakers.failure('backup');
    const res = await request(t.app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toContain(
      'gateway_requests_total{status="200",provider="primary",cache="miss",model="fast"} 1',
    );
    expect(res.text).toContain('gateway_breaker_state{provider="backup"} 2');
    expect(res.text).toContain('gateway_tokens_total{direction="input",provider="primary"} 10');
  });

  it('labels unknown model names as "unknown" to keep metrics bounded', async () => {
    const t = await testApp();
    await request(t.app)
      .post('/v1/chat')
      .set(auth(t.key))
      .send({ ...chatBody, model: 'random-123' });
    const res = await request(t.app).get('/metrics');
    expect(res.text).toContain('model="unknown"');
    expect(res.text).not.toContain('random-123');
  });
});
