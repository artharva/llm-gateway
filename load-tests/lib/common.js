// Shared helpers for the k6 scenarios. Everything runs against the mock provider,
// so results are repeatable and cost nothing.
import http from 'k6/http';
import exec from 'k6/execution';

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
export const MOCK_URL = __ENV.MOCK_URL || 'http://localhost:4000';
export const ADMIN_TOKEN = __ENV.ADMIN_TOKEN || 'change-me-admin-token';
export const RESULTS_DIR = __ENV.RESULTS_DIR || 'results';

const adminHeaders = {
  Authorization: `Bearer ${ADMIN_TOKEN}`,
  'Content-Type': 'application/json',
};

/** Creates a fresh API key through the admin API. Run from setup(). */
export function createKey(name, limits = {}) {
  const res = http.post(
    `${BASE_URL}/admin/keys`,
    JSON.stringify({
      name: `${name}-${Date.now()}`,
      owner: 'load-test',
      rate_per_min: 1_000_000,
      burst: 1_000_000,
      monthly_token_budget: 1_000_000_000,
      ...limits,
    }),
    { headers: adminHeaders },
  );
  if (res.status !== 201) {
    throw new Error(`could not create key: ${res.status} ${res.body}`);
  }
  return res.json('key');
}

/** Changes how a mock instance ("primary" or "backup") behaves. */
export function setMock(instance, settings) {
  const res = http.post(`${MOCK_URL}/control/${instance}`, JSON.stringify(settings), {
    headers: { 'Content-Type': 'application/json' },
  });
  if (res.status !== 200) throw new Error(`mock control failed: ${res.status}`);
}

export function resetMock() {
  http.post(`${MOCK_URL}/control/reset`);
}

/** Current breaker state of one provider, from the admin stats API. */
export function breakerState(provider) {
  const res = http.get(`${BASE_URL}/admin/stats/providers?range=15m`, {
    headers: adminHeaders,
    tags: { name: 'admin' },
  });
  if (res.status !== 200) return 'unknown';
  const row = res.json().find((p) => p.provider === provider);
  return row ? row.breaker : 'unknown';
}

/** One chat call through the gateway's `mock` alias (mock-primary, then mock-backup). */
export function chat(key, prompt, tags = {}) {
  return http.post(
    `${BASE_URL}/v1/chat`,
    JSON.stringify({
      model: 'mock',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 64,
    }),
    {
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      tags: { name: 'chat', ...tags },
      timeout: '35s',
    },
  );
}

/** A prompt no other request has used, so it always misses the cache. */
export function uniquePrompt() {
  return `Summarise ticket ${exec.vu.idInTest}-${exec.vu.iterationInScenario}-${Math.random().toString(36).slice(2)}`;
}

/** Provider time from the gateway's Server-Timing header, or undefined. */
export function providerMs(res) {
  const m = /provider;dur=(\d+)/.exec(res.headers['Server-Timing'] || '');
  return m ? Number(m[1]) : undefined;
}

export const elapsedMs = () => exec.instance.currentTestRunDuration;

const round = (n, d = 1) => (n === undefined || n === null ? null : Number(n.toFixed(d)));

/** Reads a value out of k6's end-of-test data, or null when the metric never got a sample. */
export function metric(data, name, stat) {
  const m = data.metrics[name];
  if (!m) return null;
  return round(m.values[stat], 2);
}

/**
 * Writes results/<scenario>.json (the numbers the README table uses, plus
 * k6's raw end-of-test data) and prints the headline numbers.
 */
export function writeSummary(scenario, data, headline) {
  const out = {
    scenario,
    finishedAt: new Date().toISOString(),
    headline,
    k6: data.metrics,
  };
  const lines = [`\n== ${scenario} ==`];
  for (const [k, v] of Object.entries(headline)) lines.push(`  ${k.padEnd(28)} ${v}`);
  return {
    stdout: `${lines.join('\n')}\n`,
    [`${RESULTS_DIR}/${scenario}.json`]: JSON.stringify(out, null, 2),
  };
}
