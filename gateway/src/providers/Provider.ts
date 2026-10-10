import type { ChatMessage, ProviderResult } from '../types';

export interface ProviderRequest {
  messages: ChatMessage[];
  max_tokens: number;
  temperature: number;
}

/**
 * The one interface the rest of the gateway knows. Each adapter translates
 * this request into its provider's own API and maps the answer back
 * (Adapter pattern), so adding a provider never touches the router.
 */
export interface Provider {
  /** The name used in config and logs, e.g. "groq" or "mock-primary". */
  readonly name: string;
  /** The upstream model this adapter calls. */
  readonly model: string;
  chat(req: ProviderRequest, signal?: AbortSignal): Promise<ProviderResult>;
  healthCheck(signal?: AbortSignal): Promise<boolean>;
}
