import type { Logger } from '../logger';

/**
 * Runs an operation against Redis and, if Redis fails, against an in-memory
 * fallback instead. The gateway fails open: a Redis outage weakens limits and
 * disables the shared cache for a while, but requests keep flowing.
 */
export class Failover {
  private lastLog = 0;

  constructor(
    private readonly component: string,
    private readonly logger?: Logger,
    private readonly onFallback?: (component: string) => void,
  ) {}

  async run<T>(primary: () => Promise<T>, fallback: () => T | Promise<T>): Promise<T> {
    try {
      return await primary();
    } catch (err) {
      this.onFallback?.(this.component);
      if (Date.now() - this.lastLog > 10_000) {
        this.lastLog = Date.now();
        this.logger?.warn(
          { component: this.component, err: (err as Error).message },
          'redis call failed; using in-memory fallback',
        );
      }
      return fallback();
    }
  }
}
