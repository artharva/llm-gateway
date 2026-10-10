import type { AliasConfig } from '../config/gatewayConfig';

/**
 * Decides the order in which an alias's providers are tried (Strategy
 * pattern). The router walks the returned list; later entries are fallbacks.
 */
export interface RoutingStrategy {
  order(chain: readonly string[]): string[];
}

/** Always the configured order: the first provider is primary, the rest are fallbacks. */
export class PriorityStrategy implements RoutingStrategy {
  order(chain: readonly string[]): string[] {
    return [...chain];
  }
}

/** Rotates the starting provider on each call to spread load; the rest stay as fallbacks. */
export class RoundRobinStrategy implements RoutingStrategy {
  private next = 0;

  order(chain: readonly string[]): string[] {
    const start = this.next++ % chain.length;
    return [...chain.slice(start), ...chain.slice(0, start)];
  }
}

export function strategyFor(alias: AliasConfig): RoutingStrategy {
  return alias.strategy === 'round-robin' ? new RoundRobinStrategy() : new PriorityStrategy();
}
