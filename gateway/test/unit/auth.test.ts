import { MemoryKeyStore } from '../../src/db/keyStore';
import { displayPrefix, generateApiKey, hashApiKey } from '../../src/keys';
import { KeyResolver } from '../../src/middleware/auth';

describe('API keys', () => {
  it('generates distinct gw_ keys of 35 characters', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a).toMatch(/^gw_[0-9A-Za-z]{32}$/);
    expect(a).not.toBe(b);
    expect(displayPrefix(a)).toBe(a.slice(0, 11));
  });

  it('hashes deterministically with SHA-256', () => {
    expect(hashApiKey('gw_x')).toBe(hashApiKey('gw_x'));
    expect(hashApiKey('gw_x')).toHaveLength(64);
  });
});

describe('KeyResolver', () => {
  it('caches lookups until the TTL passes', async () => {
    const store = new MemoryKeyStore();
    const { key } = await store.create({ name: 'a' });
    const spy = jest.spyOn(store, 'findByHash');
    let now = 0;
    const resolver = new KeyResolver(store, 1000, () => now);

    await resolver.resolve(key);
    await resolver.resolve(key);
    expect(spy).toHaveBeenCalledTimes(1);

    now = 1001;
    await resolver.resolve(key);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('sees a revoke straight away after invalidate()', async () => {
    const store = new MemoryKeyStore();
    const { key, record } = await store.create({ name: 'a' });
    const resolver = new KeyResolver(store, 60_000);
    expect((await resolver.resolve(key))?.revokedAt).toBeNull();
    await store.revoke(record.id);
    resolver.invalidate();
    expect((await resolver.resolve(key))?.revokedAt).toBeInstanceOf(Date);
  });

  it('evicts the oldest entry when full', async () => {
    const store = new MemoryKeyStore();
    const resolver = new KeyResolver(store, 60_000, Date.now, 2);
    const spy = jest.spyOn(store, 'findByHash');
    await resolver.resolve('gw_a');
    await resolver.resolve('gw_b');
    await resolver.resolve('gw_c'); // evicts gw_a
    await resolver.resolve('gw_a');
    expect(spy).toHaveBeenCalledTimes(4);
  });
});
