import type { GatewayConfig, ProviderConfig } from '../config/gatewayConfig';
import type { Logger } from '../logger';
import { GeminiProvider } from './GeminiProvider';
import { GroqProvider } from './GroqProvider';
import { MockProvider } from './MockProvider';
import { OllamaProvider } from './OllamaProvider';
import type { Provider } from './Provider';

/** Builds one adapter per configured provider (Factory). Providers missing an API key are skipped. */
export function createProviders(
  config: GatewayConfig,
  env: NodeJS.ProcessEnv,
  logger?: Logger,
): Map<string, Provider> {
  const providers = new Map<string, Provider>();
  for (const [name, cfg] of Object.entries(config.providers)) {
    const apiKey = cfg.apiKeyEnv ? env[cfg.apiKeyEnv] : undefined;
    if (cfg.apiKeyEnv && !apiKey) {
      logger?.warn({ provider: name, env: cfg.apiKeyEnv }, 'provider skipped: API key not set');
      continue;
    }
    providers.set(name, createProvider(name, cfg, apiKey ?? ''));
  }
  return providers;
}

export function createProvider(name: string, cfg: ProviderConfig, apiKey = ''): Provider {
  switch (cfg.type) {
    case 'groq':
      return new GroqProvider(name, cfg.model, cfg.baseUrl, apiKey);
    case 'gemini':
      return new GeminiProvider(name, cfg.model, cfg.baseUrl, apiKey);
    case 'ollama':
      return new OllamaProvider(name, cfg.model, cfg.baseUrl);
    case 'mock':
      return new MockProvider(name, cfg.model, cfg.baseUrl);
  }
}
