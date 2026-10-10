import request from 'supertest';
import { createApp } from '../../src/app';
import { MemoryKeyStore } from '../../src/db/keyStore';
import { silentLogger } from '../../src/logger';
import { KeyResolver } from '../../src/middleware/auth';
import { ProviderError } from '../../src/providers/errors';
import { FakeProvider } from '../helpers/fakes';

async function setup() {
  const store = new MemoryKeyStore();
  const { key, record } = await store.create({ name: 'test' });
  const provider = new FakeProvider();
  const app = createApp({ keys: new KeyResolver(store, 0), provider, logger: silentLogger });
  return { app, key, record, store, provider };
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
      text: 'hello from fake',
      usage: { input_tokens: 10, output_tokens: 5 },
      provider: 'fake',
      latency_ms: expect.any(Number),
    });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('fills in defaults for max_tokens and temperature', async () => {
    const { app, key, provider } = await setup();
    await request(app).post('/v1/chat').set('Authorization', `Bearer ${key}`).send(body);
    expect(provider.calls[0]).toMatchObject({ max_tokens: 512, temperature: 0 });
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

  it('returns 502 when the provider fails', async () => {
    const { app, key, provider } = await setup();
    provider.next = async () => {
      throw new ProviderError('fake', 'provider_unavailable', 'down', true, 503);
    };
    const res = await request(app)
      .post('/v1/chat')
      .set('Authorization', `Bearer ${key}`)
      .send(body);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('provider_unavailable');
  });
});
