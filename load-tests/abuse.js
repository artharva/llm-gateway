// Abuse: one key allowed 60 requests/min (burst 10) sends 600/min, ten times
// its limit, for a minute. A second, well-behaved key runs alongside it and
// should never be limited.
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { chat, createKey, metric, uniquePrompt, writeSummary } from './lib/common.js';

const RATE_PER_MIN = 60;
const BURST = 10;
const DURATION_S = 60;
const ABUSE_PER_S = (10 * RATE_PER_MIN) / 60;

const abuserOk = new Counter('abuser_ok');
const abuserLimited = new Counter('abuser_429');
const normalOk = new Counter('normal_ok');
const normalLimited = new Counter('normal_429');

export const options = {
  scenarios: {
    abuser: {
      executor: 'constant-arrival-rate',
      rate: ABUSE_PER_S,
      timeUnit: '1s',
      duration: `${DURATION_S}s`,
      preAllocatedVUs: 20,
      exec: 'abuser',
    },
    normal: {
      executor: 'constant-arrival-rate',
      rate: 2,
      timeUnit: '1s',
      duration: `${DURATION_S}s`,
      preAllocatedVUs: 5,
      exec: 'normal',
    },
  },
  thresholds: {
    normal_429: ['count==0'],
  },
};

export function setup() {
  return {
    abuserKey: createKey('abuser', { rate_per_min: RATE_PER_MIN, burst: BURST }),
    normalKey: createKey('normal', { rate_per_min: 600, burst: 60 }),
  };
}

export function abuser({ abuserKey }) {
  const res = chat(abuserKey, uniquePrompt(), { who: 'abuser' });
  check(res, { 'abuser: 200 or 429': (r) => r.status === 200 || r.status === 429 });
  if (res.status === 200) abuserOk.add(1);
  if (res.status === 429) abuserLimited.add(1);
}

export function normal({ normalKey }) {
  const res = chat(normalKey, uniquePrompt(), { who: 'normal' });
  check(res, { 'normal: 200': (r) => r.status === 200 });
  if (res.status === 200) normalOk.add(1);
  if (res.status === 429) normalLimited.add(1);
}

export function handleSummary(data) {
  const ok = metric(data, 'abuser_ok', 'count') ?? 0;
  const limited = metric(data, 'abuser_429', 'count') ?? 0;
  const sent = ok + limited;
  // What the token bucket should let through: the burst, plus the refill over the run.
  const allowedByPolicy = BURST + (RATE_PER_MIN * DURATION_S) / 60;
  const excess = Math.max(1, sent - allowedByPolicy);
  return writeSummary('abuse', data, {
    'abuser requests sent': sent,
    'abuser allowed (200)': ok,
    'allowed by policy': allowedByPolicy,
    'abuser rejected (429)': limited,
    'excess rejected %': Math.min(100, Number(((100 * limited) / excess).toFixed(1))),
    'normal key requests':
      (metric(data, 'normal_ok', 'count') ?? 0) + (metric(data, 'normal_429', 'count') ?? 0),
    'normal key 429s': metric(data, 'normal_429', 'count') ?? 0,
  });
}
