import type { ProviderStats } from '../api';
import { fmtCount, fmtMs, fmtUsd } from '../format';
import { BreakerBadge } from './Badge';
import { Card, Empty } from './Card';

export function ProvidersTable({ providers }: { providers: ProviderStats[] | undefined }) {
  return (
    <Card
      className="span-6"
      title="Providers"
      subtitle="Circuit breaker state is live; the rest covers the selected range."
    >
      {!providers || providers.length === 0 ? (
        <Empty>No providers configured.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Breaker</th>
                <th className="num">Requests</th>
                <th className="num">As fallback</th>
                <th className="num">p50</th>
                <th className="num">p95</th>
                <th className="num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.provider}>
                  <td>{p.provider}</td>
                  <td>
                    <BreakerBadge state={p.breaker} />
                    {p.recent_failures > 0 && p.breaker === 'closed' && (
                      <span className="meta"> {p.recent_failures} recent failures</span>
                    )}
                  </td>
                  <td className="num">{fmtCount(p.requests)}</td>
                  <td className="num">{fmtCount(p.fallbacks)}</td>
                  <td className="num">{p.requests ? fmtMs(p.p50_ms) : '–'}</td>
                  <td className="num">{p.requests ? fmtMs(p.p95_ms) : '–'}</td>
                  <td className="num">{fmtUsd(p.cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
