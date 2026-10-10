import crypto from 'node:crypto';
import type { Response } from 'express';
import type { ApiKeyRecord } from './db/keyStore';

/** Everything the gateway learns about one request; the request log is written from it. */
export class RequestContext {
  readonly requestId = crypto.randomUUID();
  readonly startedAt = performance.now();
  apiKey?: ApiKeyRecord;
  modelAlias?: string;
  provider?: string;
  inputTokens = 0;
  outputTokens = 0;
  cacheHit = false;
  cacheStatus?: 'HIT' | 'MISS' | 'BYPASS';
  fallbackUsed = false;
  attempts = 0;
  errorCode?: string;
  piiRedacted = 0;
  /** The redacted prompt, kept only when LOG_PROMPTS=true. */
  prompt?: string;

  elapsedMs(): number {
    return Math.round(performance.now() - this.startedAt);
  }
}

export function ctx(res: Response): RequestContext {
  const existing = res.locals.ctx as RequestContext | undefined;
  if (existing) return existing;
  const created = new RequestContext();
  res.locals.ctx = created;
  return created;
}
