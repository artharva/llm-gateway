import type { RequestHandler } from 'express';
import { ctx } from '../context';
import { estimateCost, type Price } from '../logging/cost';
import type { LogSink } from '../logging/requestLog';
import type { Metrics } from '../metrics/metrics';

export interface RequestLogOptions {
  prices: Record<string, Price>;
  metrics?: Metrics;
  /** Keeps metric labels bounded: unknown model names become "unknown". */
  isKnownModel?: (alias: string) => boolean;
}

/**
 * Records every /v1/chat request once its response is sent, including the
 * ones rejected by auth, validation or limits. Never the raw prompt.
 */
export function logRequests(sink: LogSink, opts: RequestLogOptions): RequestHandler {
  return (_req, res, next) => {
    const c = ctx(res);
    res.on('finish', () => {
      const latencyMs = c.elapsedMs();
      const costUsd = estimateCost(opts.prices, c.provider, c.inputTokens, c.outputTokens);
      sink.write({
        requestId: c.requestId,
        ts: new Date(),
        apiKeyId: c.apiKey?.id ?? null,
        modelAlias: c.modelAlias ?? null,
        provider: c.provider ?? null,
        status: res.statusCode,
        latencyMs,
        inputTokens: c.inputTokens,
        outputTokens: c.outputTokens,
        costUsd,
        cacheHit: c.cacheHit,
        fallbackUsed: c.fallbackUsed,
        attempts: c.attempts,
        errorCode: c.errorCode ?? null,
        piiRedacted: c.piiRedacted,
        prompt: c.prompt ?? null,
      });

      const m = opts.metrics;
      if (!m) return;
      const provider = c.provider ?? 'none';
      const model =
        c.modelAlias && (opts.isKnownModel?.(c.modelAlias) ?? true) ? c.modelAlias : 'unknown';
      const cache = c.cacheStatus?.toLowerCase() ?? 'none';
      m.requests.inc({ status: String(res.statusCode), provider, cache, model });
      m.duration.observe({ cache }, latencyMs / 1000);
      if (c.inputTokens) m.tokens.inc({ direction: 'input', provider }, c.inputTokens);
      if (c.outputTokens) m.tokens.inc({ direction: 'output', provider }, c.outputTokens);
      if (costUsd) m.cost.inc({ provider }, costUsd);
      if (c.fallbackUsed) m.fallbacks.inc({ model });
      if (c.errorCode === 'rate_limited') m.limited.inc({ reason: 'rate' });
      if (c.errorCode === 'budget_exceeded') m.limited.inc({ reason: 'budget' });
    });
    next();
  };
}
