// Provider outage: 100 virtual users on the `mock` alias. At 20 s the primary
// mock starts failing every request; at 55 s it comes back. Clients should
// see almost no errors (fallback to mock-backup), the primary's breaker should
// open within seconds, and close again once the primary recovers.
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import {
  breakerState,
  chat,
  createKey,
  elapsedMs,
  metric,
  resetMock,
  setMock,
  uniquePrompt,
  writeSummary,
} from './lib/common.js';

const FAIL_AT_S = 20;
// Deliberately not a multiple of the breaker's 20 s cooldown after the failure,
// so the recovery time measured is a typical case, not a lucky alignment.
const RECOVER_AT_S = 55;

const clientErrors = new Rate('client_errors');
const servedByBackup = new Rate('served_by_backup');
const breakerOpenAfter = new Trend('breaker_open_after_ms');
const breakerCloseAfter = new Trend('breaker_closed_after_recovery_ms');

export const options = {
  scenarios: {
    traffic: { executor: 'constant-vus', vus: 100, duration: '90s', exec: 'traffic' },
    chaos: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      startTime: `${FAIL_AT_S}s`,
      maxDuration: '70s',
      exec: 'chaos',
    },
  },
  thresholds: {
    client_errors: ['rate<0.01'],
    'client_errors{phase:outage}': ['rate<0.01'],
    'served_by_backup{phase:outage}': ['rate>0'],
    'http_req_duration{phase:outage,name:chat}': ['p(95)>0'],
    breaker_open_after_ms: ['max<30000'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  resetMock();
  setMock('primary', { delayMs: 200, failureRate: 0 });
  setMock('backup', { delayMs: 200, failureRate: 0 });
  return { key: createKey('outage') };
}

export function traffic({ key }) {
  const t = elapsedMs() / 1000;
  const phase = t < FAIL_AT_S ? 'before' : t < RECOVER_AT_S ? 'outage' : 'after';
  const res = chat(key, uniquePrompt(), { phase });
  check(res, { 'status 200': (r) => r.status === 200 });
  clientErrors.add(res.status !== 200, { phase });
  if (res.status === 200) servedByBackup.add(res.json('provider') === 'mock-backup', { phase });
}

function waitFor(state, since, limitMs) {
  while (Date.now() - since < limitMs) {
    if (breakerState('mock-primary') === state) return Date.now() - since;
    sleep(0.1);
  }
  return undefined;
}

export function chaos() {
  const failedAt = Date.now();
  setMock('primary', { failureRate: 1, failStatus: 503 });
  const opened = waitFor('open', failedAt, 30_000);
  if (opened !== undefined) breakerOpenAfter.add(opened);

  sleep(Math.max(0, RECOVER_AT_S - FAIL_AT_S - (Date.now() - failedAt) / 1000));
  const recoveredAt = Date.now();
  setMock('primary', { failureRate: 0 });
  const closed = waitFor('closed', recoveredAt, 29_000);
  if (closed !== undefined) breakerCloseAfter.add(closed);
}

export function teardown() {
  resetMock();
}

export function handleSummary(data) {
  return writeSummary('outage', data, {
    'requests (total)':
      metric(data, 'http_reqs{name:chat}', 'count') ?? metric(data, 'http_reqs', 'count'),
    'client error rate % (whole run)': Number(
      (100 * metric(data, 'client_errors', 'rate')).toFixed(2),
    ),
    'client error rate % (outage)': Number(
      (100 * metric(data, 'client_errors{phase:outage}', 'rate')).toFixed(2),
    ),
    'served by backup % (outage)': Number(
      (100 * metric(data, 'served_by_backup{phase:outage}', 'rate')).toFixed(1),
    ),
    'p95 latency ms (outage)': metric(data, 'http_req_duration{phase:outage,name:chat}', 'p(95)'),
    'breaker opened after ms': metric(data, 'breaker_open_after_ms', 'max'),
    'breaker closed after recovery ms': metric(data, 'breaker_closed_after_recovery_ms', 'max'),
  });
}
