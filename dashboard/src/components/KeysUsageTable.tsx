import type { KeyStats } from '../api';
import { fmtCount, fmtUsd } from '../format';
import type { Palette } from '../theme';
import { Badge } from './Badge';
import { BudgetMeter } from './BudgetMeter';
import { Card, Empty } from './Card';

export function KeysUsageTable({
  keys,
  palette,
}: {
  keys: KeyStats[] | undefined;
  palette: Palette;
}) {
  return (
    <Card
      className="span-12"
      title="API keys"
      subtitle="Usage in the selected range; the budget bar is month to date."
    >
      {!keys || keys.length === 0 ? (
        <Empty>No API keys yet. Create one on the Keys tab.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Status</th>
                <th className="num">Requests</th>
                <th className="num">Rate-limited</th>
                <th className="num">Failed</th>
                <th className="num">Tokens</th>
                <th className="num">Cost</th>
                <th>Monthly budget</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className={k.revoked ? 'revoked' : ''}>
                  <td>{k.name}</td>
                  <td>
                    <code>{k.key_prefix}…</code>
                  </td>
                  <td>
                    {k.revoked ? (
                      <Badge tone="muted" label="Revoked" />
                    ) : (
                      <Badge tone="good" label="Active" />
                    )}
                  </td>
                  <td className="num">{fmtCount(k.requests)}</td>
                  <td className="num">{fmtCount(k.limited)}</td>
                  <td className="num">{fmtCount(k.errors)}</td>
                  <td className="num">{fmtCount(k.tokens)}</td>
                  <td className="num">{fmtUsd(k.cost_usd)}</td>
                  <td>
                    <BudgetMeter
                      used={k.used_this_month}
                      budget={k.monthly_token_budget}
                      palette={palette}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
