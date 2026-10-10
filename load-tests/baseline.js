// Baseline: mock provider with a fixed 200 ms delay, every prompt unique (no
// cache hits). Ramps to 200 virtual users and holds there to measure
// throughput and the latency the gateway adds on top of the provider.
// VUS=600 k6 run baseline.js pushes past what 200 users can send, to find
// where the machine saturates.
import { check } from 'k6';
import { Trend } from 'k6/metrics';
import {
  chat,
  createKey,
  elapsedMs,
  metric,
  providerMs,
  resetMock,
  setMock,
  uniquePrompt,
  writeSummary,
} from './lib/common.js';

const VUS = Number(__ENV.VUS || 200);
const NAME = VUS === 200 ? 'baseline' : `baseline-${VUS}vus`;
const HOLD_FROM_MS = 45_000;
const HOLD_TO_MS = 90_000;

const overhead = new Trend('gateway_overhead_ms', true);

export const options = {
  scenarios: {
    baseline: {
      executor: 'ramping-vus',
      stages: [
        { duration: '15s', target: VUS / 4 },
        { duration: '15s', target: VUS / 2 },
        { duration: '15s', target: VUS },
        { duration: '45s', target: VUS },
        { duration: '5s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    'http_req_failed{name:chat}': ['rate<0.01'],
    // Sub-metrics only appear in the summary when a threshold names them.
    'http_reqs{phase:hold}': ['count>0'],
    'http_req_duration{phase:hold}': ['p(95)>0'],
    'gateway_overhead_ms{phase:hold}': ['p(50)<20'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  resetMock();
  setMock('primary', { delayMs: 200, jitterMs: 0, failureRate: 0 });
  setMock('backup', { delayMs: 200, jitterMs: 0, failureRate: 0 });
  return { key: createKey('baseline') };
}

export default function ({ key }) {
  const t = elapsedMs();
  const phase = t >= HOLD_FROM_MS && t < HOLD_TO_MS ? 'hold' : 'ramp';
  const res = chat(key, uniquePrompt(), { phase });
  check(res, { 'status 200': (r) => r.status === 200 });
  const p = providerMs(res);
  if (res.status === 200 && p !== undefined) overhead.add(res.timings.duration - p, { phase });
}

export function teardown() {
  resetMock();
}

export function handleSummary(data) {
  const holdSeconds = (HOLD_TO_MS - HOLD_FROM_MS) / 1000;
  return writeSummary(NAME, data, {
    vus: VUS,
    'requests (total)': metric(data, 'http_reqs', 'count'),
    'req/s at peak VUs': Number(
      (metric(data, 'http_reqs{phase:hold}', 'count') / holdSeconds).toFixed(1),
    ),
    'p50 latency ms (peak VUs)': metric(data, 'http_req_duration{phase:hold}', 'med'),
    'p95 latency ms (peak VUs)': metric(data, 'http_req_duration{phase:hold}', 'p(95)'),
    'gateway overhead p50 ms': metric(data, 'gateway_overhead_ms{phase:hold}', 'med'),
    'gateway overhead p95 ms': metric(data, 'gateway_overhead_ms{phase:hold}', 'p(95)'),
    'error rate %': Number((100 * metric(data, 'http_req_failed{name:chat}', 'rate')).toFixed(2)),
  });
}
