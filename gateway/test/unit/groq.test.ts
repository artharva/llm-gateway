import fixture from '../fixtures/groq-chat.json';
import { GroqProvider } from '../../src/providers/groq';
import { ProviderError } from '../../src/providers/errors';
import { jsonResponse, mockFetch } from '../helpers/fetch';

const req = {
  model: 'fast',
  messages: [{ role: 'user' as const, content: 'Capital of France?' }],
  max_tokens: 64,
  temperature: 0,
};

describe('GroqProvider', () => {
  it('maps the OpenAI-style response into the gateway format', async () => {
    const fetchMock = mockFetch([jsonResponse(fixture)]);
    try {
      const result = await new GroqProvider('k', 'llama-3.1-8b-instant', 'https://groq.test').chat(
        req,
      );
      expect(result).toEqual({
        text: 'Paris is the capital of France.',
        usage: { input_tokens: 14, output_tokens: 8 },
      });
      expect(fetchMock.calls[0]?.url).toBe('https://groq.test/chat/completions');
      expect(fetchMock.body()).toEqual({
        model: 'llama-3.1-8b-instant',
        messages: req.messages,
        max_tokens: 64,
        temperature: 0,
      });
    } finally {
      fetchMock.restore();
    }
  });

  it.each([
    [429, 'provider_rate_limited', true],
    [503, 'provider_unavailable', true],
    [401, 'provider_auth_failed', false],
    [400, 'provider_bad_request', false],
  ])('turns HTTP %i into %s (retryable=%s)', async (status, code, retryable) => {
    const fetchMock = mockFetch([jsonResponse({ error: 'x' }, status)]);
    try {
      const err = await new GroqProvider('k').chat(req).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect(err).toMatchObject({ code, retryable, status });
    } finally {
      fetchMock.restore();
    }
  });

  it('treats a network failure as retryable', async () => {
    const fetchMock = mockFetch([new TypeError('fetch failed')]);
    try {
      await expect(new GroqProvider('k').chat(req)).rejects.toMatchObject({
        code: 'network_error',
        retryable: true,
      });
    } finally {
      fetchMock.restore();
    }
  });
});
