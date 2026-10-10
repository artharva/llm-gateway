import request from 'supertest';
import { cacheKey, cachePolicy, normaliseRequest, parseCacheMode } from '../../src/cache/cacheKey';
import { ResponseCache } from '../../src/cache/ResponseCache';
import type { ChatRequest } from '../../src/types';
import { chatBody, testApp } from '../helpers/app';

const base: ChatRequest = {
  model: 'fast',
  messages: [
    { role: 'system', content: 'Be brief.' },
    { role: 'user', content: 'What is Redis?' },
  ],
  max_tokens: 100,
  temperature: 0,
};
const opts = { namespace: 'v1', scope: 'global' as const };

describe('cache key', () => {
  it('is a namespaced SHA-256 of the normalised request', () => {
    expect(cacheKey(base, opts)).toMatch(/^cache:v1:[0-9a-f]{64}$/);
  });

  it('ignores surrounding whitespace, line-ending style and the order of JSON fields', () => {
    const reordered = JSON.parse(
      '{"temperature":0,"max_tokens":100,"messages":[{"content":"  Be brief.\\r\\n","role":"system"},{"content":"What is Redis?\\n","role":"user"}],"model":"fast"}',
    ) as ChatRequest;
    expect(cacheKey(reordered, opts)).toBe(cacheKey(base, opts));
  });

  it.each([
    ['another alias', { model: 'smart' }],
    ['another prompt', { messages: [{ role: 'user' as const, content: 'What is Postgres?' }] }],
    ['another role', { messages: [{ role: 'assistant' as const, content: 'What is Redis?' }] }],
    ['inner whitespace', { messages: [{ role: 'user' as const, content: 'What  is Redis?' }] }],
    ['another max_tokens', { max_tokens: 101 }],
    ['another temperature', { temperature: 0.5 }],
  ])('changes with %s', (_label, change) => {
    expect(cacheKey({ ...base, ...change }, opts)).not.toBe(cacheKey(base, opts));
  });

  it('separates keys only when scope is "key", and changes with the namespace', () => {
    expect(cacheKey(base, opts, 1)).toBe(cacheKey(base, opts, 2));
    expect(cacheKey(base, { ...opts, scope: 'key' }, 1)).not.toBe(
      cacheKey(base, { ...opts, scope: 'key' }, 2),
    );
    expect(cacheKey(base, { ...opts, namespace: 'v2' })).not.toBe(cacheKey(base, opts));
  });

  it('normalises without changing roles or order', () => {
    expect(normaliseRequest(base).messages.map((m) => m.role)).toEqual(['system', 'user']);
  });
});

describe('cache policy', () => {
  it('caches deterministic requests and skips temperature > 0 unless forced', () => {
    expect(cachePolicy(base, undefined)).toEqual({ read: true, write: true });
    expect(cachePolicy({ ...base, temperature: 0.7 }, undefined)).toEqual({
      read: false,
      write: false,
    });
    expect(cachePolicy({ ...base, temperature: 0.7 }, 'force')).toEqual({
      read: true,
      write: true,
    });
    expect(cachePolicy(base, 'bypass')).toEqual({ read: false, write: false });
    expect(parseCacheMode(' FORCE ')).toBe('force');
    expect(parseCacheMode('yes')).toBeUndefined();
  });
});

describe('ResponseCache without Redis', () => {
  it('expires entries after the TTL and evicts the least recently used', async () => {
    let now = 0;
    const cache = new ResponseCache(null, { ttlSeconds: 10, now: () => now, maxMemoryEntries: 2 });
    const value = { text: 't', usage: { input_tokens: 1, output_tokens: 1 }, provider: 'p' };
    await cache.set('a', value);
    await cache.set('b', value);
    await cache.get('a'); // a is now more recent than b
    await cache.set('c', value); // evicts b
    expect(await cache.get('b')).toBeNull();
    expect(await cache.get('a')).toEqual(value);
    now = 10_001;
    expect(await cache.get('a')).toBeNull();
  });
});

describe('caching on /v1/chat', () => {
  async function setup() {
    const t = await testApp({ key: { ratePerMin: 1000, burst: 1000 } });
    const send = (body: object = chatBody, header?: string) => {
      const r = request(t.app).post('/v1/chat').set('Authorization', `Bearer ${t.key}`);
      if (header) r.set('X-Gateway-Cache', header);
      return r.send(body);
    };
    return { ...t, send };
  }

  it('serves a repeat from the cache without calling the provider, billing zero tokens', async () => {
    const { send, primary, budget, record } = await setup();
    const first = await send();
    expect(first.headers['x-cache']).toBe('MISS');
    const second = await send();
    expect(second.headers['x-cache']).toBe('HIT');
    expect(second.body).toMatchObject({
      text: first.body.text,
      provider: 'primary',
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    expect(primary.calls).toHaveLength(1);
    expect(await budget.used(record.id)).toBe(15);
  });

  it('does not cache temperature > 0 unless the client opts in', async () => {
    const { send, primary } = await setup();
    const warm = { ...chatBody, temperature: 0.8 };
    expect((await send(warm)).headers['x-cache']).toBe('BYPASS');
    expect((await send(warm)).headers['x-cache']).toBe('BYPASS');
    expect(primary.calls).toHaveLength(2);
    await send(warm, 'force');
    expect((await send(warm, 'force')).headers['x-cache']).toBe('HIT');
    expect(primary.calls).toHaveLength(3);
  });

  it('never caches a failed answer', async () => {
    const { send, primary, backup } = await setup();
    const fail = async () => {
      throw new (await import('../../src/providers/errors')).ProviderError(
        'x',
        'provider_unavailable',
        'down',
        true,
        503,
      );
    };
    primary.behaviour = fail;
    backup.behaviour = fail;
    expect((await send()).status).toBe(502);
    primary.behaviour = async () => ({
      text: 'ok now',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const res = await send();
    expect(res.headers['x-cache']).toBe('MISS');
    expect(res.body.text).toBe('ok now');
  });

  it('bypass skips both reading and writing', async () => {
    const { send, primary } = await setup();
    await send(chatBody, 'bypass');
    expect((await send()).headers['x-cache']).toBe('MISS');
    expect(primary.calls).toHaveLength(2);
  });
});
