import type { RequestHandler } from 'express';
import { ctx } from '../context';
import type { Metrics } from '../metrics/metrics';
import { redactMessages } from '../privacy/redact';
import type { ChatRequest } from '../types';

/**
 * Masks emails, phone numbers, Aadhaar, PAN and card numbers in every message
 * before the request reaches the cache or any provider. Everything after this
 * step, including cache keys and logs, only ever sees the masked text.
 */
export function redactPii(opts: { metrics?: Metrics; logPrompts?: boolean } = {}): RequestHandler {
  return (_req, res, next) => {
    const body = res.locals.body as ChatRequest;
    const result = redactMessages(body.messages);
    res.locals.body = { ...body, messages: result.messages };
    const c = ctx(res);
    c.piiRedacted = result.total;
    if (result.total > 0) {
      res.setHeader('X-PII-Redacted', String(result.total));
      for (const [type, n] of Object.entries(result.counts))
        opts.metrics?.redactions.inc({ type }, n);
    }
    if (opts.logPrompts) c.prompt = JSON.stringify(result.messages);
    next();
  };
}
