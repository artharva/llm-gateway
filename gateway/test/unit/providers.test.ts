import gemini from '../fixtures/gemini-generate.json';
import groq from '../fixtures/groq-chat.json';
import mock from '../fixtures/mock-chat.json';
import ollama from '../fixtures/ollama-chat.json';
import { ProviderError } from '../../src/providers/errors';
import { GeminiProvider } from '../../src/providers/GeminiProvider';
import { GroqProvider } from '../../src/providers/GroqProvider';
import { parseRetryAfter } from '../../src/providers/http';
import { MockProvider } from '../../src/providers/MockProvider';
import { OllamaProvider } from '../../src/providers/OllamaProvider';
import type { Provider, ProviderRequest } from '../../src/providers/Provider';
import { jsonResponse, mockFetch } from '../helpers/fetch';

const req: ProviderRequest = {
  messages: [
    { role: 'system', content: 'Be brief.' },
    { role: 'user', content: 'Capital of France?' },
    { role: 'assistant', content: 'Which France?' },
    { role: 'user', content: 'The country.' },
  ],
  max_tokens: 64,
  temperature: 0.2,
};

async function withFetch<T>(
  responses: (Response | Error)[],
  fn: (m: ReturnType<typeof mockFetch>) => Promise<T>,
) {
  const m = mockFetch(responses);
  try {
    return await fn(m);
  } finally {
    m.restore();
  }
}

describe('GroqProvider', () => {
  const groqProvider = new GroqProvider('groq', 'llama-3.1-8b-instant', 'https://groq.test', 'k');

  it('sends the OpenAI format and maps the answer', () =>
    withFetch([jsonResponse(groq)], async (m) => {
      expect(await groqProvider.chat(req)).toEqual({
        text: 'Paris is the capital of France.',
        usage: { input_tokens: 14, output_tokens: 8 },
      });
      expect(m.calls[0]?.url).toBe('https://groq.test/chat/completions');
      expect(m.calls[0]?.init.headers).toMatchObject({ authorization: 'Bearer k' });
      expect(m.body()).toEqual({
        model: 'llama-3.1-8b-instant',
        messages: req.messages,
        max_tokens: 64,
        temperature: 0.2,
      });
    }));
});

describe('GeminiProvider', () => {
  const geminiProvider = new GeminiProvider(
    'gemini',
    'gemini-flash-lite-latest',
    'https://g.test/v1beta',
    'k',
  );

  it('moves system messages to systemInstruction and renames assistant to model', () =>
    withFetch([jsonResponse(gemini)], async (m) => {
      const result = await geminiProvider.chat(req);
      expect(m.calls[0]?.url).toBe(
        'https://g.test/v1beta/models/gemini-flash-lite-latest:generateContent',
      );
      expect(m.calls[0]?.init.headers).toMatchObject({ 'x-goog-api-key': 'k' });
      expect(m.body()).toEqual({
        contents: [
          { role: 'user', parts: [{ text: 'Capital of France?' }] },
          { role: 'model', parts: [{ text: 'Which France?' }] },
          { role: 'user', parts: [{ text: 'The country.' }] },
        ],
        systemInstruction: { parts: [{ text: 'Be brief.' }] },
        generationConfig: { maxOutputTokens: 64, temperature: 0.2 },
      });
      // Text parts are joined; thinking tokens are billed as output.
      expect(result).toEqual({
        text: 'Paris is the capital of France.',
        usage: { input_tokens: 12, output_tokens: 10 },
      });
    }));

  it('skips thought parts', () =>
    withFetch(
      [
        jsonResponse({
          candidates: [{ content: { parts: [{ text: 'hmm', thought: true }, { text: 'Yes.' }] } }],
        }),
      ],
      async () => {
        expect((await geminiProvider.chat(req)).text).toBe('Yes.');
      },
    ));

  it('sends a system-only request as a user turn', () =>
    withFetch([jsonResponse(gemini)], async (m) => {
      await geminiProvider.chat({ ...req, messages: [{ role: 'system', content: 'Say hi' }] });
      expect(m.body()).toMatchObject({ contents: [{ role: 'user', parts: [{ text: 'Say hi' }] }] });
      expect(m.body()).not.toHaveProperty('systemInstruction');
    }));

  it('reports a blocked prompt as a non-retryable error', () =>
    withFetch([jsonResponse({ promptFeedback: { blockReason: 'SAFETY' } })], async () => {
      await expect(geminiProvider.chat(req)).rejects.toMatchObject({
        code: 'content_blocked',
        retryable: false,
      });
    }));
});

describe('OllamaProvider', () => {
  it('disables streaming and maps eval counts to usage', () =>
    withFetch([jsonResponse(ollama)], async (m) => {
      const result = await new OllamaProvider('ollama', 'llama3.2:1b', 'http://o.test').chat(req);
      expect(m.calls[0]?.url).toBe('http://o.test/api/chat');
      expect(m.body()).toEqual({
        model: 'llama3.2:1b',
        messages: req.messages,
        stream: false,
        options: { num_predict: 64, temperature: 0.2 },
      });
      expect(result).toEqual({
        text: 'Paris is the capital of France.',
        usage: { input_tokens: 31, output_tokens: 9 },
      });
    }));
});

describe('MockProvider', () => {
  it('posts to its instance path', () =>
    withFetch([jsonResponse(mock)], async (m) => {
      const result = await new MockProvider('mock-primary', 'mock-1', 'http://m.test/primary').chat(
        req,
      );
      expect(m.calls[0]?.url).toBe('http://m.test/primary/v1/chat');
      expect(result).toEqual(mock);
    }));
});

describe('error mapping shared by every adapter', () => {
  const adapters: Provider[] = [
    new GroqProvider('groq', 'm', 'https://x.test', 'k'),
    new GeminiProvider('gemini', 'm', 'https://x.test', 'k'),
    new OllamaProvider('ollama', 'm', 'http://x.test'),
    new MockProvider('mock', 'm', 'http://x.test'),
  ];

  it.each(
    adapters.flatMap(
      (a) =>
        [
          [a.name, 429, 'provider_rate_limited', true],
          [a.name, 503, 'provider_unavailable', true],
          [a.name, 401, 'provider_auth_failed', false],
          [a.name, 400, 'provider_bad_request', false],
        ] as const,
    ),
  )('%s: HTTP %i becomes %s (retryable=%s)', (name, status, code, retryable) =>
    withFetch([jsonResponse({ error: 'x' }, status, { 'retry-after': '2' })], async () => {
      const adapter = adapters.find((a) => a.name === name)!;
      const err = await adapter.chat(req).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect(err).toMatchObject({ provider: name, code, retryable, status, retryAfterMs: 2000 });
    }),
  );

  it('treats a network failure as retryable', () =>
    withFetch(
      [Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })],
      async () => {
        await expect(adapters[0]!.chat(req)).rejects.toMatchObject({
          code: 'network_error',
          message: 'ECONNREFUSED',
          retryable: true,
        });
      },
    ));

  it('reports an aborted call as a timeout', async () => {
    const controller = new AbortController();
    controller.abort();
    await withFetch([Object.assign(new Error('aborted'), { name: 'AbortError' })], async () => {
      await expect(adapters[0]!.chat(req, controller.signal)).rejects.toMatchObject({
        code: 'timeout',
        retryable: true,
      });
    });
  });

  it('health checks report false instead of throwing', () =>
    withFetch([new TypeError('fetch failed'), jsonResponse({})], async () => {
      expect(await adapters[0]!.healthCheck()).toBe(false);
      expect(await adapters[1]!.healthCheck()).toBe(true);
    }));

  it('parses Retry-After in seconds or as a date', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('nonsense')).toBeUndefined();
    expect(parseRetryAfter(new Date(Date.now() + 5000).toUTCString())).toBeGreaterThan(3000);
  });
});
