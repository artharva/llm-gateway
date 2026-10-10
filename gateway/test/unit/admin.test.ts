import request from 'supertest';
import type { StatsSource } from '../../src/db/statsRepo';
import { ADMIN_TOKEN, chatBody, testApp } from '../helpers/app';

const admin = { Authorization: `Bearer ${ADMIN_TOKEN}` };

describe('admin API', () => {
  it('rejects a missing or wrong admin token', async () => {
    const { app } = await testApp();
    expect((await request(app).get('/admin/keys')).status).toBe(401);
    expect((await request(app).get('/admin/keys').set('Authorization', 'Bearer nope')).status).toBe(
      401,
    );
  });

  it('does not accept an API key as an admin token', async () => {
    const { app, key } = await testApp();
    expect(
      (await request(app).get('/admin/keys').set('Authorization', `Bearer ${key}`)).status,
    ).toBe(401);
  });

  it('creates a key, shows the plaintext once, and the key works straight away', async () => {
    const { app } = await testApp();
    const created = await request(app).post('/admin/keys').set(admin).send({
      name: 'agentloop',
      owner: 'atharva',
      rate_per_min: 30,
      monthly_token_budget: 50_000,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: 'agentloop',
      rate_per_min: 30,
      burst: 30,
      monthly_token_budget: 50_000,
    });
    expect(created.body.key).toMatch(/^gw_/);

    const chat = await request(app)
      .post('/v1/chat')
      .set('Authorization', `Bearer ${created.body.key}`)
      .send(chatBody);
    expect(chat.status).toBe(200);

    const list = await request(app).get('/admin/keys').set(admin);
    expect(list.body).toHaveLength(2);
    expect(JSON.stringify(list.body)).not.toContain(created.body.key);
    expect(list.body[1]).toMatchObject({ name: 'agentloop', used_this_month: 15 });
  });

  it('validates input', async () => {
    const { app } = await testApp();
    const res = await request(app)
      .post('/admin/keys')
      .set(admin)
      .send({ name: '', rate_per_min: -1 });
    expect(res.status).toBe(400);
    expect((await request(app).patch('/admin/keys/abc').set(admin).send({})).status).toBe(400);
    expect(
      (await request(app).patch('/admin/keys/999').set(admin).send({ name: 'x' })).status,
    ).toBe(404);
  });

  it('changes limits immediately', async () => {
    const t = await testApp();
    const send = () =>
      request(t.app).post('/v1/chat').set('Authorization', `Bearer ${t.key}`).send(chatBody);
    expect((await send()).status).toBe(200);
    await request(t.app)
      .patch(`/admin/keys/${t.record.id}`)
      .set(admin)
      .send({ monthly_token_budget: 10 })
      .expect(200);
    expect((await send()).status).toBe(429);
  });

  it('revokes a key, and the next request with it is rejected', async () => {
    const t = await testApp();
    const send = () =>
      request(t.app).post('/v1/chat').set('Authorization', `Bearer ${t.key}`).send(chatBody);
    expect((await send()).status).toBe(200);
    const res = await request(t.app).post(`/admin/keys/${t.record.id}/revoke`).set(admin);
    expect(res.body.revoked_at).not.toBeNull();
    expect((await send()).status).toBe(401);
  });

  it('serves stats for a validated range, with breaker state per provider', async () => {
    const calls: string[] = [];
    const stats: StatsSource = {
      overview: async (r) => (calls.push(`overview:${r}`), { requests: 3 } as never),
      timeseries: async (r) => (calls.push(`timeseries:${r}`), []),
      keys: async (r) => (calls.push(`keys:${r}`), [{ id: 1, name: 'test' } as never]),
      providers: async () => [
        {
          provider: 'primary',
          requests: 9,
          fallbacks: 0,
          p50_ms: 200,
          p95_ms: 250,
          tokens: 10,
          cost_usd: 0,
        },
      ],
    };
    const t = await testApp({ stats });
    expect((await request(t.app).get('/admin/stats/overview?range=24h').set(admin)).body).toEqual({
      requests: 3,
    });
    await request(t.app).get('/admin/stats/timeseries').set(admin);
    expect(calls).toEqual(['overview:24h', 'timeseries:1h']);
    expect((await request(t.app).get('/admin/stats/overview?range=1y').set(admin)).status).toBe(
      400,
    );

    const keys = await request(t.app).get('/admin/stats/keys').set(admin);
    expect(keys.body[0]).toMatchObject({ id: 1, used_this_month: 0 });

    for (let i = 0; i < 5; i++) await t.breakers.failure('backup');
    const providers = await request(t.app).get('/admin/stats/providers').set(admin);
    expect(providers.body).toEqual([
      expect.objectContaining({ provider: 'primary', breaker: 'closed', requests: 9, p95_ms: 250 }),
      expect.objectContaining({ provider: 'backup', breaker: 'open', requests: 0 }),
    ]);
  });
});
