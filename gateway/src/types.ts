import { z } from 'zod';

export const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().min(1, 'content must not be empty').max(200_000),
});

export const chatRequestSchema = z
  .object({
    model: z.string().min(1).max(100),
    messages: z.array(messageSchema).min(1, 'at least one message is required').max(500),
    max_tokens: z.number().int().positive().max(32_768).default(512),
    // Default 0: deterministic answers, which also makes them cacheable.
    temperature: z.number().min(0).max(2).default(0),
  })
  .strict();

export type ChatMessage = z.infer<typeof messageSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

/** What a provider adapter returns after mapping its own response format. */
export interface ProviderResult {
  text: string;
  usage: Usage;
}

/** The gateway's response format, the same for every provider. */
export interface ChatResponse {
  text: string;
  usage: Usage;
  provider: string;
  latency_ms: number;
}
