import type { Overview } from '../api';
import { fmtCount, fmtMs, fmtPct, fmtUsd } from '../format';

export function StatTiles({ o }: { o: Overview | undefined }) {
  const v = (fn: (o: Overview) => string) => (o ? fn(o) : '–');
  const tiles = [
    {
      label: 'Requests',
      value: v((o) => fmtCount(o.requests)),
      sub: v((o) => `${fmtPct(o.ok, o.requests)} succeeded`),
    },
    {
      label: 'Cache hit rate',
      value: v((o) => fmtPct(o.cache_hits, o.ok)),
      sub: v((o) => `${fmtCount(o.cache_hits)} hits`),
    },
    {
      label: 'Latency p50 / p95',
      value: v((o) => fmtMs(o.p50_ms)),
      sub: v((o) => `p95 ${fmtMs(o.p95_ms)}`),
    },
    {
      label: 'Fallbacks',
      value: v((o) => fmtCount(o.fallbacks)),
      sub: v((o) => `${fmtPct(o.fallbacks, o.ok)} of successes`),
    },
    {
      label: 'Rate-limited',
      value: v((o) => fmtCount(o.limited)),
      sub: v((o) => `${fmtCount(o.errors)} failed (5xx)`),
    },
    {
      label: 'Tokens',
      value: v((o) => fmtCount(o.input_tokens + o.output_tokens)),
      sub: v((o) => `${fmtCount(o.input_tokens)} in · ${fmtCount(o.output_tokens)} out`),
    },
    { label: 'Cost', value: v((o) => fmtUsd(o.cost_usd)), sub: 'at configured prices' },
  ];
  return (
    <div className="tiles">
      {tiles.map((t) => (
        <div className="tile" key={t.label}>
          <div className="label">{t.label}</div>
          <div className="value">{t.value}</div>
          <div className="sub">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}
