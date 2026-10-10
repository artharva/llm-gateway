import type { GatewayConfig } from '../config/gatewayConfig';
import { HttpError } from '../errors';
import { ProviderError } from '../providers/errors';
import type { Provider, ProviderRequest } from '../providers/Provider';
import type { ProviderResult } from '../types';
import { strategyFor, type RoutingStrategy } from './strategies';

export interface RouteResult {
  result: ProviderResult;
  provider: string;
  attempts: number;
  fallbackUsed: boolean;
}

interface AliasRoute {
  chain: string[];
  strategy: RoutingStrategy;
  timeoutMs: number;
}

/** Maps a model alias ("fast", "smart") to providers, chosen by the alias's strategy. */
export class Router {
  private readonly aliases = new Map<string, AliasRoute>();

  constructor(
    config: GatewayConfig,
    private readonly providers: Map<string, Provider>,
  ) {
    for (const [name, alias] of Object.entries(config.aliases)) {
      this.aliases.set(name, {
        chain: alias.chain,
        strategy: strategyFor(alias),
        timeoutMs: alias.timeoutMs,
      });
    }
  }

  aliasNames(): string[] {
    return [...this.aliases.keys()];
  }

  /** The providers to try for an alias, in order, leaving out unconfigured ones. */
  plan(alias: string): Provider[] {
    const route = this.aliases.get(alias);
    if (!route) {
      throw new HttpError(400, 'unknown_model', `Unknown model "${alias}"`, {
        available: this.aliasNames(),
      });
    }
    const plan = route.strategy
      .order(route.chain)
      .map((name) => this.providers.get(name))
      .filter((p): p is Provider => p !== undefined);
    if (plan.length === 0) {
      throw new HttpError(
        503,
        'no_provider_configured',
        `No provider is configured for "${alias}"`,
      );
    }
    return plan;
  }

  async route(alias: string, req: ProviderRequest): Promise<RouteResult> {
    const [provider] = this.plan(alias);
    try {
      const result = await provider!.chat(req);
      return { result, provider: provider!.name, attempts: 1, fallbackUsed: false };
    } catch (err) {
      if (err instanceof ProviderError) {
        throw new HttpError(502, err.code, `Provider ${err.provider} failed: ${err.message}`);
      }
      throw err;
    }
  }
}
