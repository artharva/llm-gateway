import fs from 'node:fs';
import path from 'node:path';
import { loadGatewayConfig, parseGatewayConfig } from '../../src/config/gatewayConfig';
import { HttpError } from '../../src/errors';
import { createProviders } from '../../src/providers/registry';
import { Router } from '../../src/router/Router';
import { PriorityStrategy, RoundRobinStrategy } from '../../src/router/strategies';
import { fakeConfig, FakeProvider, memoryBreakers, providerMap } from '../helpers/fakes';

const configFile = path.join(__dirname, '..', '..', 'config', 'gateway.json');

describe('gateway config', () => {
  it('the shipped config file is valid', () => {
    const config = loadGatewayConfig(configFile, {});
    expect(Object.keys(config.aliases)).toEqual(expect.arrayContaining(['fast', 'smart', 'mock']));
  });

  it('rejects an alias that points at an unknown provider', () => {
    expect(() =>
      parseGatewayConfig({ providers: {}, aliases: { fast: { chain: ['ghost'] } } }),
    ).toThrow(/unknown provider "ghost"/);
  });

  it('lets an env var override a base URL and trims trailing slashes', () => {
    const raw = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    const config = parseGatewayConfig(raw, {
      MOCK_PRIMARY_URL: 'http://mock-provider:4000/primary/',
    });
    expect(config.providers['mock-primary']?.baseUrl).toBe('http://mock-provider:4000/primary');
  });

  it('skips providers whose API key is missing', () => {
    const config = loadGatewayConfig(configFile, {});
    const providers = createProviders(config, { GROQ_API_KEY: 'k' });
    expect(providers.has('groq')).toBe(true);
    expect(providers.has('gemini')).toBe(false);
    expect(providers.has('ollama')).toBe(true);
  });
});

describe('routing strategies', () => {
  it('priority keeps the configured order', () => {
    expect(new PriorityStrategy().order(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('round-robin rotates the first provider and keeps the rest as fallbacks', () => {
    const rr = new RoundRobinStrategy();
    expect(rr.order(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(rr.order(['a', 'b', 'c'])).toEqual(['b', 'c', 'a']);
    expect(rr.order(['a', 'b', 'c'])).toEqual(['c', 'a', 'b']);
    expect(rr.order(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });
});

describe('Router', () => {
  it('sends an alias to the provider named in config, so swapping needs no code change', async () => {
    const a = new FakeProvider('a');
    const b = new FakeProvider('b');
    const req = {
      messages: [{ role: 'user' as const, content: 'x' }],
      max_tokens: 5,
      temperature: 0,
    };

    const first = new Router(
      fakeConfig({ fast: { chain: ['a', 'b'] } }),
      providerMap(a, b),
      memoryBreakers(),
    );
    expect((await first.route('fast', req)).provider).toBe('a');

    const swapped = new Router(
      fakeConfig({ fast: { chain: ['b', 'a'] } }),
      providerMap(a, b),
      memoryBreakers(),
    );
    expect((await swapped.route('fast', req)).provider).toBe('b');
  });

  it('leaves unconfigured providers out of the plan', () => {
    const b = new FakeProvider('b');
    const router = new Router(
      fakeConfig({ fast: { chain: ['a', 'b'] } }),
      providerMap(b),
      memoryBreakers(),
    );
    expect(router.plan('fast').map((p) => p.name)).toEqual(['b']);
  });

  it('returns 503 when no provider of an alias is configured', () => {
    const router = new Router(
      fakeConfig({ fast: { chain: ['a'] } }),
      providerMap(),
      memoryBreakers(),
    );
    expect(() => router.plan('fast')).toThrow(HttpError);
    expect(() => router.plan('fast')).toThrow(/No provider is configured/);
  });
});
