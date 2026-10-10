import request from 'supertest';
import { createMockServer } from '../src/server';

const defaults = { delayMs: 0, jitterMs: 0, failureRate: 0, failStatus: 503 };
const chat = { messages: [{ role: 'user', content: 'Hello there' }], max_tokens: 50 };

describe('mock provider', () => {
  it('answers in the gateway mock format with token estimates', async () => {
    const { app } = createMockServer(defaults);
    const res = await request(app).post('/primary/v1/chat').send(chat);
    expect(res.status).toBe(200);
    expect(res.body.text).toBe('Mock answer from primary to: "Hello there"');
    expect(res.body.usage).toEqual({ input_tokens: 3, output_tokens: 11 });
  });

  it('fails every request when failureRate is 1, per instance', async () => {
    const { app } = createMockServer(defaults);
    await request(app)
      .post('/control/primary')
      .send({ failureRate: 1, failStatus: 500 })
      .expect(200);
    await request(app).post('/primary/v1/chat').send(chat).expect(500);
    await request(app).get('/primary/health').expect(500);
    await request(app).post('/backup/v1/chat').send(chat).expect(200);
    const control = await request(app).get('/control');
    expect(control.body.instances.primary).toMatchObject({ requests: 1, failures: 1 });
    expect(control.body.instances.backup).toMatchObject({ requests: 1, failures: 0 });
  });

  it('waits delayMs before answering', async () => {
    const { app } = createMockServer({ ...defaults, delayMs: 120 });
    const start = Date.now();
    await request(app).post('/slow/v1/chat').send(chat).expect(200);
    expect(Date.now() - start).toBeGreaterThanOrEqual(110);
  });

  it('ignores invalid control values and resets', async () => {
    const { app } = createMockServer(defaults);
    const res = await request(app).post('/control/p').send({ delayMs: -5, failureRate: 7 });
    expect(res.body).toMatchObject({ delayMs: 0, failureRate: 1 });
    await request(app).post('/control/reset').expect(200);
    expect((await request(app).get('/control')).body.instances).toEqual({});
  });

  it('uses the injected random source for partial failure rates', async () => {
    const rolls = [0.1, 0.9];
    const { app } = createMockServer({ ...defaults, failureRate: 0.5 }, () => rolls.shift() ?? 0);
    await request(app).post('/x/v1/chat').send(chat).expect(503);
    await request(app).post('/x/v1/chat').send(chat).expect(200);
  });
});
