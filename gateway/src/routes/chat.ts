import { Router } from 'express';
import { ctx } from '../context';
import { HttpError } from '../errors';
import { requireApiKey, type KeyResolver } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import type { ChatProvider } from '../providers/groq';
import { ProviderError } from '../providers/errors';
import { chatRequestSchema, type ChatRequest, type ChatResponse } from '../types';

export interface ChatRouteDeps {
  keys: KeyResolver;
  provider: ChatProvider;
}

export function chatRoutes(deps: ChatRouteDeps): Router {
  const router = Router();
  router.post(
    '/v1/chat',
    requireApiKey(deps.keys),
    validateBody(chatRequestSchema),
    async (_req, res) => {
      const body = res.locals.body as ChatRequest;
      const c = ctx(res);
      c.modelAlias = body.model;
      c.attempts = 1;
      let result;
      try {
        result = await deps.provider.chat(body);
      } catch (err) {
        if (err instanceof ProviderError) {
          throw new HttpError(502, err.code, `Provider ${err.provider} failed: ${err.message}`);
        }
        throw err;
      }
      c.provider = deps.provider.name;
      c.inputTokens = result.usage.input_tokens;
      c.outputTokens = result.usage.output_tokens;
      const response: ChatResponse = {
        text: result.text,
        usage: result.usage,
        provider: deps.provider.name,
        latency_ms: c.elapsedMs(),
      };
      res.json(response);
    },
  );
  return router;
}
