// Cache benefit: same setup as the baseline, but half the requests repeat one
// of 50 popular prompts. Measures the hit rate and how much faster hits are.
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import {
  chat,
  createKey,
  metric,
  resetMock,
  setMock,
  uniquePrompt,
  writeSummary,
} from './lib/common.js';

const POPULAR = 50;
const hitRate = new Rate('cache_hit_rate');
const hitLatency = new Trend('latency_hit_ms', true);
const missLatency = new Trend('latency_miss_ms', true);

export const options = {
  scenarios: {
    cache: { executor: 'constant-vus', vus: 100, duration: '60s' },
  },
  thresholds: {
    'http_req_failed{name:chat}': ['rate<0.01'],
    latency_hit_ms: ['p(50)<10'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  resetMock();
  setMock('primary', { delayMs: 200, jitterMs: 0, failureRate: 0 });
  return { key: createKey('cache'), run: Date.now() };
}

export default function ({ key, run }) {
  const repeat = Math.random() < 0.5;
  // The run id keeps one test's popular prompts from hitting entries cached by an earlier run.
  const prompt = repeat
    ? `Popular question ${Math.floor(Math.random() * POPULAR)} (run ${run})`
    : uniquePrompt();
  const res = chat(key, prompt, { repeat: String(repeat) });
  check(res, { 'status 200': (r) => r.status === 200 });
  if (res.status !== 200) return;
  const hit = res.headers['X-Cache'] === 'HIT';
  hitRate.add(hit);
  (hit ? hitLatency : missLatency).add(res.timings.duration);
}

export function teardown() {
  resetMock();
}

export function handleSummary(data) {
  return writeSummary('cache', data, {
    'requests (total)': metric(data, 'http_reqs', 'count'),
    'hit rate %': Number((100 * metric(data, 'cache_hit_rate', 'rate')).toFixed(1)),
    'p50 on hits ms': metric(data, 'latency_hit_ms', 'med'),
    'p95 on hits ms': metric(data, 'latency_hit_ms', 'p(95)'),
    'p50 on misses ms': metric(data, 'latency_miss_ms', 'med'),
    'p95 on misses ms': metric(data, 'latency_miss_ms', 'p(95)'),
    'error rate %': Number((100 * metric(data, 'http_req_failed{name:chat}', 'rate')).toFixed(2)),
  });
}
