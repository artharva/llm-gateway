import type { ProviderResult } from '../types';
import { isReachable, postJson } from './http';
import type { Provider, ProviderRequest } from './Provider';

interface OllamaResponse {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

/** A local Ollama server: no API key, and token counts come from its eval counters. */
export class OllamaProvider implements Provider {
  constructor(
    readonly name: string,
    readonly model: string,
    private readonly baseUrl: string,
  ) {}

  async chat(req: ProviderRequest, signal?: AbortSignal): Promise<ProviderResult> {
    const body = await postJson<OllamaResponse>(
      this.name,
      `${this.baseUrl}/api/chat`,
      {
        model: this.model,
        messages: req.messages,
        stream: false,
        options: { num_predict: req.max_tokens, temperature: req.temperature },
      },
      {},
      signal,
    );
    return {
      text: body.message?.content ?? '',
      usage: { input_tokens: body.prompt_eval_count ?? 0, output_tokens: body.eval_count ?? 0 },
    };
  }

  healthCheck(signal?: AbortSignal): Promise<boolean> {
    return isReachable(`${this.baseUrl}/api/tags`, {}, signal);
  }
}
