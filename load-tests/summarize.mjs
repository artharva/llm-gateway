// Turns results/*.json into the markdown table the README uses.
//   node load-tests/summarize.mjs [results-dir]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? join(import.meta.dirname, 'results');
const read = (name) => {
  const file = join(dir, `${name}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
};
const h = (name) => read(name)?.headline;
const ms = (v) => (v === null || v === undefined ? 'n/a' : `${Math.round(v)} ms`);
const pct = (v) => (v === null || v === undefined ? 'n/a' : `${v}%`);

const rows = [];
for (const name of ['baseline', 'baseline-600vus']) {
  const b = h(name);
  if (!b) continue;
  rows.push([
    name === 'baseline' ? 'Baseline' : 'Baseline, pushed further',
    `Mock 200 ms, no cache hits, ramp to ${b.vus} VUs`,
    `${b['req/s at peak VUs']} req/s at ${b.vus} VUs; p50 ${ms(b['p50 latency ms (peak VUs)'])}, p95 ${ms(b['p95 latency ms (peak VUs)'])}; gateway overhead p50 ${ms(b['gateway overhead p50 ms'])}, p95 ${ms(b['gateway overhead p95 ms'])}; errors ${pct(b['error rate %'])}`,
  ]);
}
const c = h('cache');
if (c)
  rows.push([
    'Cache benefit',
    '100 VUs, 50% of prompts repeat',
    `hit rate ${pct(c['hit rate %'])}; p50 on hits ${ms(c['p50 on hits ms'])} vs ${ms(c['p50 on misses ms'])} on misses`,
  ]);
const o = h('outage');
if (o)
  rows.push([
    'Provider outage',
    '100 VUs; primary fails 100% from 20 s to 55 s',
    `client errors ${pct(o['client error rate % (outage)'])} during the outage (${pct(o['client error rate % (whole run)'])} overall); breaker opened after ${ms(o['breaker opened after ms'])}, closed ${ms(o['breaker closed after recovery ms'])} after recovery; p95 ${ms(o['p95 latency ms (outage)'])} during the outage`,
  ]);
const s = h('slow');
if (s)
  rows.push([
    'Slow provider',
    '100 VUs; primary takes 10 s, alias timeout 2 s',
    `p50 ${ms(s['p50 latency ms'])}, p95 ${ms(s['p95 latency ms'])}, max ${ms(s['max latency ms'])}; errors ${pct(s['client error rate %'])}; ${pct(s['served by backup %'])} served by the backup`,
  ]);
const a = h('abuse');
if (a)
  rows.push([
    'Abuse',
    'Key limited to 60/min (burst 10) sends 600/min',
    `${a['abuser rejected (429)']} of ${a['abuser requests sent']} rejected with 429 (${pct(a['excess rejected %'])} of the excess; ${a['abuser allowed (200)']} allowed vs ${a['allowed by policy']} by policy); well-behaved key: ${a['normal key 429s']} 429s in ${a['normal key requests']} requests`,
  ]);

const machine = existsSync(join(dir, 'machine.json'))
  ? JSON.parse(readFileSync(join(dir, 'machine.json'), 'utf8'))
  : undefined;
const lines = [
  '| Scenario | Setup | Result |',
  '| --- | --- | --- |',
  ...rows.map((r) => `| ${r.join(' | ')} |`),
];
if (machine)
  lines.push(
    '',
    `Machine: ${machine.cpu ? `${machine.cpu}, ` : ''}${machine.cpus} CPUs, ${machine.memory_mb} MB RAM, ${machine.os}, k6 ${machine.k6}. Gateway, mock provider, Redis, Postgres and k6 all on the same machine.`,
  );
const md = `${lines.join('\n')}\n`;
writeFileSync(join(dir, 'summary.md'), md);
process.stdout.write(md);
