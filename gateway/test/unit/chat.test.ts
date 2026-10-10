import request from 'supertest';
import { ProviderError } from '../../src/providers/errors';
import { testApp } from '../helpers/app';
import { fakeConfig } from '../helpers/fakes';

async function setup() {
  return testApp({ config: fakeConfig({ fast: { chain: ['primary'] } }) });
}

const body = { model: 'fast', messages: [{ role: 'user', content: 'hi' }] };

describe('POST /v1/chat', () => {
  it('returns the common response format', async () => {
    const { app, key } = await setup();
    const res = await request(app)
      .post('/v1/chat')
      .set('Authorization', `Bearer ${key}`)
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      text: 'hello from primary',
      usage: { input_tokens: 10, output_tokens: 5 },
      provider: 'primary',
      latency_ms: expect.any(Number),
    });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reports provider time in Server-Timing so overhead can be measured', async () => {
    const { app, key, primary } = await setup();
    primary.behaviour = async () => {
      await new Promise((r) => setTimeout(r, 40));
      return { text: 'slow', usage: { input_tokens: 1, output_tokens: 1 } };
    };
    const res = await request(app)
      .post('/v1/chat')
      .set('Authorization', `Bearer ${key}`)
      .send(body);
    const dur = Number(/provider;dur=(\d+)/.exec(res.headers['server-timing'] ?? '')?.[1]);
    expect(dur).toBeGreaterThanOrEqual(35);
    expect(dur).toBeLessThanOrEqual(res.body.latency_ms);
  });

  it('fills in defaults for max_tokens and temperature', async () => {
    const { app, key, primary: provider } = await setup();
    await request(app).post('/v1/chat').set('Authorization', `Bearer ${key}`).send(body);
    expect(provider.calls[0]).toMatchObject({ max_tokens: 512, temperature: 0 });
  });

  it('returns 400 with the list of aliases for an unknown model', async () => {
    const { app, key } = await setup();
    const res = await request(app)
      .post('/v1/chat')
      .set('Authorization', `Bearer ${key}`)
      .send({ ...body, model: 'gpt-9' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'unknown_model',
      details: { available: ['fast'] },
    });
  });

  it.each([
    ['no header', undefined, 'missing_api_key'],
    ['wrong scheme', 'Basic abc', 'missing_api_key'],
    ['unknown key', 'Bearer gw_doesnotexist', 'invalid_api_key'],
  ])('returns 401 for %s', async (_label, header, code) => {
    const { app } = await setup();
    const req = request(app).post('/v1/chat').send(body);
    if (header) req.set('Authorization', header);
    const res = await req;
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(code);
  });

  it('returns 401 for a revoked key', async () => {
    const { app, key, store, record } = await setup();
    await store.revoke(record.id);
    const res = await request(app)
      .post('/v1/chat')
      .set('Authorization', `Bearer ${key}`)
      .send(body);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_api_key');
  });

  it.each([
    ['missing messages', { model: 'fast' }, 'messages'],
    ['empty messages', { model: 'fast', messages: [] }, 'messages'],
    ['bad role', { model: 'fast', messages: [{ role: 'robot', content: 'x' }] }, 'messages.0.role'],
    ['negative max_tokens', { ...body, max_tokens: -1 }, 'max_tokens'],
    ['unknown field', { ...body, stream: true }, '(body)'],
  ])('returns 400 with the failing field for %s', async (_label, payload, path) => {
    const { app, key } = await setup();
    const res = await request(app)
      .post('/v1/chat')
      .set('Authorization', `Bearer ${key}`)
      .send(payload);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(path);
  });

  it('returns 400 for malformed JSON', async () => {
    const { app, key } = await setup();
    const res = await request(app)
      .post('/v1/chat')
      .set('Authorization', `Bearer ${key}`)
      .set('Content-Type', 'application/json')
      .send('{"model":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_json');
  });

  it('returns 502 with each failure when every provider fails', async () => {
    const { app, key, primary: provider } = await setup();
    provider.behaviour = async () => {
      throw new ProviderError('primary', 'provider_unavailable', 'down', true, 503);
    };
    const res = await request(app)
      .post('/v1/chat')
      .set('Authorization', `Bearer ${key}`)
      .send(body);
    expect(res.status).toBe(502);
  });

  it('returns 404 for unknown routes', async () => {
    const { app } = await setup();
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});
