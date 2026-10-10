import type { ProviderResult } from '../types';
import { ProviderError } from './errors';
import { isReachable, postJson } from './http';
import type { Provider, ProviderRequest } from './Provider';

interface GeminiPart {
  text?: string;
  thought?: boolean;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
}

/**
 * Google's generateContent API. System messages become systemInstruction,
 * "assistant" becomes "model", and thinking tokens count as output because
 * they are billed as output.
 */
export class GeminiProvider implements Provider {
  constructor(
    readonly name: string,
    readonly model: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async chat(req: ProviderRequest, signal?: AbortSignal): Promise<ProviderResult> {
    const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content);
    let contents = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
    if (contents.length === 0) {
      // Gemini needs at least one turn; a system-only request becomes the user turn.
      contents = [{ role: 'user', parts: [{ text: system.join('\n\n') }] }];
      system.length = 0;
    }
    const body = await postJson<GeminiResponse>(
      this.name,
      `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`,
      {
        contents,
        ...(system.length ? { systemInstruction: { parts: [{ text: system.join('\n\n') }] } } : {}),
        generationConfig: { maxOutputTokens: req.max_tokens, temperature: req.temperature },
      },
      { 'x-goog-api-key': this.apiKey },
      signal,
    );
    const candidate = body.candidates?.[0];
    if (!candidate) {
      const reason = body.promptFeedback?.blockReason ?? 'no candidates returned';
      throw new ProviderError(this.name, 'content_blocked', reason, false);
    }
    const usage = body.usageMetadata ?? {};
    return {
      text: (candidate.content?.parts ?? [])
        .filter((p) => !p.thought)
        .map((p) => p.text ?? '')
        .join(''),
      usage: {
        input_tokens: usage.promptTokenCount ?? 0,
        output_tokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
      },
    };
  }

  healthCheck(signal?: AbortSignal): Promise<boolean> {
    return isReachable(
      `${this.baseUrl}/models/${encodeURIComponent(this.model)}`,
      { 'x-goog-api-key': this.apiKey },
      signal,
    );
  }
}
