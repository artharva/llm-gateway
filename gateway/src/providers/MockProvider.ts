import type { ProviderResult } from '../types';
import { isReachable, postJson } from './http';
import type { Provider, ProviderRequest } from './Provider';

/**
 * Talks to the mock-provider service, whose delay and failure rate can be
 * changed at runtime. Load and failure tests run against it so they are free
 * and repeatable.
 */
export class MockProvider implements Provider {
  constructor(
    readonly name: string,
    readonly model: string,
    private readonly baseUrl: string,
  ) {}

  chat(req: ProviderRequest, signal?: AbortSignal): Promise<ProviderResult> {
    return postJson<ProviderResult>(
      this.name,
      `${this.baseUrl}/v1/chat`,
      { messages: req.messages, max_tokens: req.max_tokens },
      {},
      signal,
    );
  }

  healthCheck(signal?: AbortSignal): Promise<boolean> {
    return isReachable(`${this.baseUrl}/health`, {}, signal);
  }
}
