import crypto from 'node:crypto';
import type { ChatRequest } from '../types';

export interface CacheKeyOptions {
  /** Bump to invalidate every cached answer, e.g. after changing an alias's providers. */
  namespace: string;
  /** "key" keeps each API key's answers separate; "global" shares them. */
  scope: 'global' | 'key';
}

/**
 * Everything that changes the answer goes into the key, in a fixed order:
 * alias, every message (role + content), max_tokens and temperature.
 * Content is trimmed and line endings unified, but inner whitespace is kept
 * because it can matter (code, tables).
 */
export function normaliseRequest(req: ChatRequest) {
  return {
    model: req.model,
    messages: req.messages.map((m) => ({
      role: m.role,
      content: m.content.replace(/\r\n?/g, '\n').trim(),
    })),
    max_tokens: req.max_tokens,
    temperature: req.temperature,
  };
}

export function cacheKey(req: ChatRequest, opts: CacheKeyOptions, apiKeyId?: number): string {
  const payload = { ...normaliseRequest(req), ...(opts.scope === 'key' ? { key: apiKeyId } : {}) };
  const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return `cache:${opts.namespace}:${hash}`;
}

export type CacheMode = 'force' | 'bypass' | undefined;

/**
 * Temperature above 0 asks for varied answers, so caching it would hide that
 * variety; the client can still opt in with X-Gateway-Cache: force.
 * X-Gateway-Cache: bypass skips the cache entirely.
 */
export function cachePolicy(req: ChatRequest, mode: CacheMode): { read: boolean; write: boolean } {
  if (mode === 'bypass') return { read: false, write: false };
  const cacheable = req.temperature === 0 || mode === 'force';
  return { read: cacheable, write: cacheable };
}

export function parseCacheMode(header: string | undefined): CacheMode {
  const value = header?.trim().toLowerCase();
  return value === 'force' || value === 'bypass' ? value : undefined;
}
