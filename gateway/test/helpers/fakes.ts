import { parseGatewayConfig, type GatewayConfig } from '../../src/config/gatewayConfig';
import type { Provider, ProviderRequest } from '../../src/providers/Provider';
import type { ProviderResult } from '../../src/types';

type Behaviour = (req: ProviderRequest, signal?: AbortSignal) => Promise<ProviderResult>;

/** A provider whose replies and failures a test controls. */
export class FakeProvider implements Provider {
  readonly model = 'fake-model';
  calls: ProviderRequest[] = [];
  healthy = true;
  behaviour: Behaviour = async () => ({
    text: `hello from ${this.name}`,
    usage: { input_tokens: 10, output_tokens: 5 },
  });

  constructor(readonly name = 'fake') {}

  chat(req: ProviderRequest, signal?: AbortSignal): Promise<ProviderResult> {
    this.calls.push(req);
    return this.behaviour(req, signal);
  }

  async healthCheck(): Promise<boolean> {
    return this.healthy;
  }
}

/** Builds a valid config whose providers are all "mock" entries named after the given chains. */
export function fakeConfig(
  aliases: Record<
    string,
    { chain: string[]; strategy?: 'priority' | 'round-robin'; timeoutMs?: number }
  >,
  extra: Record<string, unknown> = {},
): GatewayConfig {
  const names = new Set(Object.values(aliases).flatMap((a) => a.chain));
  const providers = Object.fromEntries(
    [...names].map((n) => [n, { type: 'mock', model: 'm', baseUrl: `http://${n}.test` }]),
  );
  return parseGatewayConfig({ providers, aliases, ...extra }, {});
}

export function providerMap(...providers: Provider[]): Map<string, Provider> {
  return new Map(providers.map((p) => [p.name, p]));
}
