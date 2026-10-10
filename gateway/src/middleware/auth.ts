import type { RequestHandler } from 'express';
import { ctx } from '../context';
import type { ApiKeyRecord, KeyStore } from '../db/keyStore';
import { HttpError } from '../errors';
import { hashApiKey } from '../keys';

/**
 * Looks keys up by hash, with a short in-process cache so a busy key costs one
 * database query per TTL rather than one per request. A revoke clears the cache
 * on this instance; other instances notice within the TTL.
 */
export class KeyResolver {
  private readonly cache = new Map<string, { record: ApiKeyRecord | null; expires: number }>();

  constructor(
    private readonly store: KeyStore,
    private readonly ttlMs = 30_000,
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 10_000,
  ) {}

  async resolve(rawKey: string): Promise<ApiKeyRecord | null> {
    const hash = hashApiKey(rawKey);
    const hit = this.cache.get(hash);
    if (hit && hit.expires > this.now()) return hit.record;
    const record = await this.store.findByHash(hash);
    if (this.cache.size >= this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(hash, { record, expires: this.now() + this.ttlMs });
    return record;
  }

  invalidate(): void {
    this.cache.clear();
  }
}

export function requireApiKey(resolver: KeyResolver): RequestHandler {
  return async (req, res, next) => {
    const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '');
    if (!match?.[1]) {
      throw new HttpError(401, 'missing_api_key', 'Send your key as "Authorization: Bearer <key>"');
    }
    const record = await resolver.resolve(match[1]);
    if (!record || record.revokedAt) {
      throw new HttpError(401, 'invalid_api_key', 'API key is invalid or has been revoked');
    }
    ctx(res).apiKey = record;
    next();
  };
}
