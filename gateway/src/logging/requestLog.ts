import type { Pool } from 'pg';
import type { Logger } from '../logger';

export interface RequestLogEntry {
  requestId: string;
  ts: Date;
  apiKeyId: number | null;
  modelAlias: string | null;
  provider: string | null;
  status: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  cacheHit: boolean;
  fallbackUsed: boolean;
  attempts: number;
  errorCode: string | null;
  piiRedacted: number;
  prompt: string | null;
}

export interface LogSink {
  write(entry: RequestLogEntry): void;
}

/** Keeps entries in memory; used by unit tests. */
export class MemoryLogSink implements LogSink {
  readonly entries: RequestLogEntry[] = [];
  write(entry: RequestLogEntry): void {
    this.entries.push(entry);
  }
}

const COLUMNS = [
  'request_id',
  'ts',
  'api_key_id',
  'model_alias',
  'provider',
  'status',
  'latency_ms',
  'input_tokens',
  'output_tokens',
  'cost_usd',
  'cache_hit',
  'fallback_used',
  'attempts',
  'error_code',
  'pii_redacted',
  'prompt',
];

function values(e: RequestLogEntry): unknown[] {
  return [
    e.requestId,
    e.ts,
    e.apiKeyId,
    e.modelAlias,
    e.provider,
    e.status,
    e.latencyMs,
    e.inputTokens,
    e.outputTokens,
    e.costUsd,
    e.cacheHit,
    e.fallbackUsed,
    e.attempts,
    e.errorCode,
    e.piiRedacted,
    e.prompt,
  ];
}

/**
 * Writes request logs to Postgres off the request path: entries are queued
 * and flushed as one multi-row INSERT every flushMs or every batchSize rows.
 * If Postgres is slow or down, the queue is capped and the oldest rows are
 * dropped (and counted) rather than letting memory grow without limit.
 */
export class PgLogWriter implements LogSink {
  private queue: RequestLogEntry[] = [];
  private timer: NodeJS.Timeout;
  private flushing: Promise<void> | null = null;
  dropped = 0;

  constructor(
    private readonly pool: Pool,
    private readonly opts: {
      logger?: Logger;
      flushMs?: number;
      batchSize?: number;
      maxQueue?: number;
      onDrop?: (n: number) => void;
    } = {},
  ) {
    this.timer = setInterval(() => void this.flush(), opts.flushMs ?? 500);
    this.timer.unref();
  }

  write(entry: RequestLogEntry): void {
    this.queue.push(entry);
    const max = this.opts.maxQueue ?? 10_000;
    if (this.queue.length > max) {
      const n = this.queue.length - max;
      this.queue.splice(0, n);
      this.dropped += n;
      this.opts.onDrop?.(n);
    }
    if (this.queue.length >= (this.opts.batchSize ?? 200)) void this.flush();
  }

  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.opts.batchSize ?? 200);
    const params: unknown[] = [];
    const rows = batch.map((e) => {
      const start = params.length;
      params.push(...values(e));
      return `(${COLUMNS.map((_, i) => `$${start + i + 1}`).join(', ')})`;
    });
    this.flushing = this.pool
      .query(`INSERT INTO request_logs (${COLUMNS.join(', ')}) VALUES ${rows.join(', ')}`, params)
      .then(() => undefined)
      .catch((err: Error) => {
        this.dropped += batch.length;
        this.opts.onDrop?.(batch.length);
        this.opts.logger?.error(
          { err: err.message, rows: batch.length },
          'failed to write request logs',
        );
      })
      .finally(() => {
        this.flushing = null;
      });
    await this.flushing;
    if (this.queue.length >= (this.opts.batchSize ?? 200)) await this.flush();
  }

  async close(): Promise<void> {
    clearInterval(this.timer);
    while (this.queue.length > 0 || this.flushing) await this.flush();
  }
}

/** Tokens a key has used since monthStart, from the durable log (seeds lost budget counters). */
export async function monthlyTokensFromLog(
  pool: Pool,
  keyId: number,
  monthStart: Date,
): Promise<number> {
  const { rows } = await pool.query<{ used: string }>(
    `SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS used
       FROM request_logs WHERE api_key_id = $1 AND ts >= $2`,
    [keyId, monthStart],
  );
  return Number(rows[0]?.used ?? 0);
}
