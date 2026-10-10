import type { ProviderResult } from '../types';
import { isReachable, postJson } from './http';
import type { Provider, ProviderRequest } from './Provider';

interface GroqResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Groq speaks the OpenAI chat-completions format. */
export class GroqProvider implements Provider {
  constructor(
    readonly name: string,
    readonly model: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async chat(req: ProviderRequest, signal?: AbortSignal): Promise<ProviderResult> {
    const body = await postJson<GroqResponse>(
      this.name,
      `${this.baseUrl}/chat/completions`,
      {
        model: this.model,
        messages: req.messages,
        max_tokens: req.max_tokens,
        temperature: req.temperature,
      },
      { authorization: `Bearer ${this.apiKey}` },
      signal,
    );
    return {
      text: body.choices?.[0]?.message?.content ?? '',
      usage: {
        input_tokens: body.usage?.prompt_tokens ?? 0,
        output_tokens: body.usage?.completion_tokens ?? 0,
      },
    };
  }

  healthCheck(signal?: AbortSignal): Promise<boolean> {
    return isReachable(
      `${this.baseUrl}/models`,
      { authorization: `Bearer ${this.apiKey}` },
      signal,
    );
  }
}
