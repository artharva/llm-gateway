// Slow provider: the primary mock takes 10 s to answer, but the `mock` alias
// gives each provider call 2 s. Timeouts count as failures, so the breaker
// opens and later requests go straight to mock-backup. p95 should stay under
// the 2 s timeout plus one fallback call (~2.2 s).
import { check } from 'k6';
import { Rate } from 'k6/metrics';
import {
  chat,
  createKey,
  metric,
  resetMock,
  setMock,
  uniquePrompt,
  writeSummary,
} from './lib/common.js';

const ALIAS_TIMEOUT_MS = 2000;
const clientErrors = new Rate('client_errors');
const servedByBackup = new Rate('served_by_backup');

export const options = {
  scenarios: {
    slow: { executor: 'constant-vus', vus: 100, duration: '60s' },
  },
  thresholds: {
    client_errors: ['rate<0.01'],
    'http_req_duration{name:chat}': [`p(95)<${ALIAS_TIMEOUT_MS + 200}`],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  resetMock();
  setMock('primary', { delayMs: 10_000, failureRate: 0 });
  setMock('backup', { delayMs: 200, failureRate: 0 });
  return { key: createKey('slow') };
}

export default function ({ key }) {
  const res = chat(key, uniquePrompt());
  check(res, { 'status 200': (r) => r.status === 200 });
  clientErrors.add(res.status !== 200);
  if (res.status === 200) servedByBackup.add(res.json('provider') === 'mock-backup');
}

export function teardown() {
  resetMock();
}

export function handleSummary(data) {
  return writeSummary('slow', data, {
    'requests (total)':
      metric(data, 'http_reqs{name:chat}', 'count') ?? metric(data, 'http_reqs', 'count'),
    'client error rate %': Number((100 * metric(data, 'client_errors', 'rate')).toFixed(2)),
    'served by backup %': Number((100 * metric(data, 'served_by_backup', 'rate')).toFixed(1)),
    'p50 latency ms': metric(data, 'http_req_duration{name:chat}', 'med'),
    'p95 latency ms': metric(data, 'http_req_duration{name:chat}', 'p(95)'),
    'p99 latency ms': metric(data, 'http_req_duration{name:chat}', 'p(99)'),
    'max latency ms': metric(data, 'http_req_duration{name:chat}', 'max'),
  });
}
