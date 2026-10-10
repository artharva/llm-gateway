import crypto from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const KEY_PREFIX = 'gw_';

/** A new API key: "gw_" + 32 random base62 characters (about 190 bits). */
export function generateApiKey(): string {
  const bytes = crypto.randomBytes(32);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % 62];
  return KEY_PREFIX + out;
}

/**
 * Keys are long random strings, so a fast hash is enough: there is nothing to
 * brute-force the way there is with a password, and lookup stays one index hit.
 */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/** The first 11 characters, shown in the admin UI so people can tell keys apart. */
export function displayPrefix(key: string): string {
  return key.slice(0, KEY_PREFIX.length + 8);
}
