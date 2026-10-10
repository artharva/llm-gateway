import type { GatewayConfig } from '../config/gatewayConfig';
import { HttpError } from '../errors';
import type { Logger } from '../logger';
import { ProviderError } from '../providers/errors';
import type { Provider, ProviderRequest } from '../providers/Provider';
import type { CircuitBreakers } from '../reliability/CircuitBreaker';
import { retry, type RetryPolicy } from '../reliability/retry';
import { withTimeout } from '../reliability/timeout';
import type { ProviderResult } from '../types';
import { strategyFor, type RoutingStrategy } from './strategies';

export interface RouteResult {
  result: ProviderResult;
  provider: string;
  /** Provider calls made, including retries and failed fallbacks. */
  attempts: number;
  /** True when the answer came from anything but the first provider in the plan. */
  fallbackUsed: boolean;
}

export interface AttemptFailure {
  provider: string;
  code: string;
  message: string;
}

interface AliasRoute {
  chain: string[];
  strategy: RoutingStrategy;
  timeoutMs: number;
}

export interface RouterOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  logger?: Logger;
  onProviderFailure?: (provider: string, code: string) => void;
}

/** Failures that say nothing about the provider's health, so they must not trip its breaker. */
const REQUEST_SPECIFIC = new Set(['provider_bad_request', 'content_blocked', 'circuit_open']);

/**
 * Maps a model alias to an ordered list of providers and walks it: each
 * provider gets a timeout and retries for transient errors; a provider whose
 * circuit breaker is open is skipped at once; on failure the next one is tried.
 */
export class Router {
  private readonly aliases = new Map<string, AliasRoute>();
  private readonly policy: RetryPolicy;
  private readonly deadlineMs: number;
  private readonly now: () => number;

  constructor(
    config: GatewayConfig,
    private readonly providers: Map<string, Provider>,
    private readonly breakers: CircuitBreakers,
    private readonly opts: RouterOptions = {},
  ) {
    for (const [name, alias] of Object.entries(config.aliases)) {
      this.aliases.set(name, {
        chain: alias.chain,
        strategy: strategyFor(alias),
        timeoutMs: alias.timeoutMs,
      });
    }
    this.policy = config.retry;
    this.deadlineMs = config.requestDeadlineMs;
    this.now = opts.now ?? Date.now;
  }

  aliasNames(): string[] {
    return [...this.aliases.keys()];
  }

  providerNames(): string[] {
    return [...this.providers.keys()];
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
    const plan = this.plan(alias);
    const timeoutMs = this.aliases.get(alias)!.timeoutMs;
    const deadline = this.now() + this.deadlineMs;
    const failures: AttemptFailure[] = [];
    let attempts = 0;

    for (const [index, provider] of plan.entries()) {
      if (this.now() >= deadline) break;
      try {
        const result = await retry(
          async () => {
            // Checked before every attempt: a retry must not hammer a provider whose breaker just opened.
            if (!(await this.breakers.allow(provider.name))) {
              throw new ProviderError(
                provider.name,
                'circuit_open',
                'circuit breaker is open',
                false,
              );
            }
            attempts++;
            try {
              const budget = Math.min(timeoutMs, deadline - this.now());
              const value = await withTimeout(provider.name, budget, (signal) =>
                provider.chat(req, signal),
              );
              await this.breakers.success(provider.name);
              return value;
            } catch (err) {
              const code = err instanceof ProviderError ? err.code : 'internal_error';
              if (!REQUEST_SPECIFIC.has(code)) await this.breakers.failure(provider.name);
              this.opts.onProviderFailure?.(provider.name, code);
              throw err;
            }
          },
          this.policy,
          {
            deadline,
            now: this.now,
            sleep: this.opts.sleep,
            random: this.opts.random,
            onRetry: (err, n, delay) =>
              this.opts.logger?.debug(
                { provider: provider.name, retry: n, delay, err: (err as Error).message },
                'retrying',
              ),
          },
        );
        return { result, provider: provider.name, attempts, fallbackUsed: index > 0 };
      } catch (err) {
        if (!(err instanceof ProviderError)) throw err;
        failures.push({ provider: err.provider, code: err.code, message: err.message });
        this.opts.logger?.warn(
          { provider: provider.name, code: err.code, alias },
          'provider failed; trying next',
        );
      }
    }

    if (this.now() >= deadline) {
      throw new HttpError(
        504,
        'gateway_timeout',
        `No provider answered within ${this.deadlineMs} ms`,
        { failures },
      );
    }
    if (failures.length > 0 && failures.every((f) => f.code === 'circuit_open')) {
      throw new HttpError(
        503,
        'all_circuits_open',
        `Every provider for "${alias}" is failing; try again shortly`,
        { failures },
        { 'Retry-After': String(Math.ceil(this.breakers.settings.cooldownMs / 1000)) },
      );
    }
    throw new HttpError(502, 'all_providers_failed', `Every provider for "${alias}" failed`, {
      failures,
    });
  }
}
