import type { ChatRequest, ProviderResult } from '../types';
import { codeForStatus, isRetryableStatus, ProviderError } from './errors';

export interface ChatProvider {
  readonly name: string;
  chat(req: ChatRequest): Promise<ProviderResult>;
}

interface GroqResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Groq speaks the OpenAI chat-completions format. */
export class GroqProvider implements ChatProvider {
  readonly name = 'groq';

  constructor(
    private readonly apiKey: string,
    private readonly model = 'llama-3.1-8b-instant',
    private readonly baseUrl = 'https://api.groq.com/openai/v1',
  ) {}

  async chat(req: ChatRequest): Promise<ProviderResult> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          messages: req.messages,
          max_tokens: req.max_tokens,
          temperature: req.temperature,
        }),
      });
    } catch (err) {
      throw new ProviderError(this.name, 'network_error', (err as Error).message, true);
    }
    if (!res.ok) {
      throw new ProviderError(
        this.name,
        codeForStatus(res.status),
        `groq returned HTTP ${res.status}`,
        isRetryableStatus(res.status),
        res.status,
      );
    }
    const body = (await res.json()) as GroqResponse;
    return {
      text: body.choices?.[0]?.message?.content ?? '',
      usage: {
        input_tokens: body.usage?.prompt_tokens ?? 0,
        output_tokens: body.usage?.completion_tokens ?? 0,
      },
    };
  }
}
