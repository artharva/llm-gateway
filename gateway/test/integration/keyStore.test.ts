import type { Pool } from 'pg';
import { PgKeyStore } from '../../src/db/keyStore';
import { migrate } from '../../src/db/migrate';
import { hashApiKey } from '../../src/keys';
import { freshDatabase } from '../helpers/db';
import { describeIntegration } from '../helpers/env';

describeIntegration('PgKeyStore (Postgres)', () => {
  let pool: Pool;
  let store: PgKeyStore;

  beforeAll(async () => {
    pool = await freshDatabase();
    store = new PgKeyStore(pool);
  });
  afterAll(() => pool.end());

  it('migrations are idempotent', async () => {
    expect(await migrate(pool)).toEqual([]);
  });

  it('stores only the hash and finds the key by it', async () => {
    const { key, record } = await store.create({
      name: 'chatbot',
      owner: 'team-a',
      ratePerMin: 30,
    });
    const raw = await pool.query('SELECT key_hash FROM api_keys WHERE id = $1', [record.id]);
    expect(raw.rows[0].key_hash).toBe(hashApiKey(key));
    expect(JSON.stringify(raw.rows)).not.toContain(key);

    const found = await store.findByHash(hashApiKey(key));
    expect(found).toMatchObject({ name: 'chatbot', owner: 'team-a', ratePerMin: 30, burst: 30 });
    expect(found?.monthlyTokenBudget).toBe(1_000_000);
  });

  it('updates limits and revokes', async () => {
    const { record } = await store.create({ name: 'summariser' });
    const updated = await store.update(record.id, { ratePerMin: 10, monthlyTokenBudget: 5000 });
    expect(updated).toMatchObject({ ratePerMin: 10, monthlyTokenBudget: 5000 });
    const revoked = await store.revoke(record.id);
    expect(revoked?.revokedAt).toBeInstanceOf(Date);
    expect(await store.update(9999, { name: 'x' })).toBeNull();
  });
});
