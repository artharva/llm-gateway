import type { Pool } from 'pg';
import { PgKeyStore } from '../../src/db/keyStore';
import {
  monthlyTokensFromLog,
  PgLogWriter,
  type RequestLogEntry,
} from '../../src/logging/requestLog';
import { freshDatabase } from '../helpers/db';
import { describeIntegration } from '../helpers/env';

describeIntegration('request logs in Postgres', () => {
  let pool: Pool;
  let keyId: number;
  beforeAll(async () => {
    pool = await freshDatabase();
    keyId = (await new PgKeyStore(pool).create({ name: 'logs' })).record.id;
  });
  afterAll(() => pool.end());

  const entry = (overrides: Partial<RequestLogEntry> = {}): RequestLogEntry => ({
    requestId: crypto.randomUUID(),
    ts: new Date('2026-10-10T10:00:00Z'),
    apiKeyId: keyId,
    modelAlias: 'fast',
    provider: 'groq',
    status: 200,
    latencyMs: 120,
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0.000009,
    cacheHit: false,
    fallbackUsed: false,
    attempts: 1,
    errorCode: null,
    piiRedacted: 0,
    prompt: null,
    ...overrides,
  });

  it('batches 450 entries into multi-row inserts', async () => {
    const writer = new PgLogWriter(pool, { batchSize: 200, flushMs: 60_000 });
    const spy = jest.spyOn(pool, 'query');
    for (let i = 0; i < 450; i++) writer.write(entry());
    await writer.close();
    const inserts = spy.mock.calls.filter((c) =>
      String(c[0]).startsWith('INSERT INTO request_logs'),
    );
    expect(inserts).toHaveLength(3);
    spy.mockRestore();
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n, sum(cost_usd)::float AS cost FROM request_logs',
    );
    expect(rows[0].n).toBe(450);
    expect(rows[0].cost).toBeCloseTo(450 * 0.000009);
  });

  it("sums a key's tokens for the month, which seeds a lost budget counter", async () => {
    await pool.query('DELETE FROM request_logs');
    const writer = new PgLogWriter(pool);
    writer.write(entry({ ts: new Date('2026-09-30T23:59:59Z') }));
    writer.write(entry());
    writer.write(entry({ inputTokens: 7, outputTokens: 3 }));
    await writer.close();
    expect(await monthlyTokensFromLog(pool, keyId, new Date('2026-10-01T00:00:00Z'))).toBe(160);
  });

  it('drops (and counts) rows it cannot write instead of throwing', async () => {
    const drops: number[] = [];
    const writer = new PgLogWriter(pool, { onDrop: (n) => drops.push(n) });
    writer.write(entry({ apiKeyId: 999_999 })); // violates the foreign key
    await writer.close();
    expect(drops).toEqual([1]);
    expect(writer.dropped).toBe(1);
  });
});
