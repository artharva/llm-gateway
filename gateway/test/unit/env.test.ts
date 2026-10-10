import { loadEnv } from '../../src/config/env';

describe('loadEnv', () => {
  it('treats a blank ADMIN_TOKEN as unset, so the admin API is off instead of a crash', () => {
    expect(loadEnv({ ADMIN_TOKEN: '' }).ADMIN_TOKEN).toBeUndefined();
  });

  it('keeps a valid ADMIN_TOKEN', () => {
    expect(loadEnv({ ADMIN_TOKEN: 'change-me-admin-token' }).ADMIN_TOKEN).toBe(
      'change-me-admin-token',
    );
  });

  it('rejects a short ADMIN_TOKEN with a readable message', () => {
    expect(() => loadEnv({ ADMIN_TOKEN: 'abc' })).toThrow(
      /Invalid environment:[\s\S]*ADMIN_TOKEN must be at least 8 characters/,
    );
  });
});
