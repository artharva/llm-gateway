import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { KeyStats } from '../api';
import { fmtCount, fmtUsd } from '../format';
import type { Palette } from '../theme';
import { ChartCard, Empty } from './Card';
import { ChartTooltip } from './ChartTooltip';

export function CostByKey({ keys, palette }: { keys: KeyStats[] | undefined; palette: Palette }) {
  const rows = (keys ?? [])
    .filter((k) => k.requests > 0)
    .sort((a, b) => b.cost_usd - a.cost_usd || b.tokens - a.tokens)
    .slice(0, 8);

  return (
    <ChartCard
      className="span-6"
      title="Cost by API key"
      subtitle="Top 8 keys in this range, at the prices in gateway.json."
      chart={
        rows.length === 0 ? (
          <Empty>No key has made a request in this range.</Empty>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(120, rows.length * 34 + 30)}>
            <BarChart
              data={rows}
              layout="vertical"
              margin={{ top: 0, right: 16, bottom: 0, left: 0 }}
              barCategoryGap={8}
            >
              <CartesianGrid horizontal={false} stroke={palette.grid} />
              <XAxis
                type="number"
                tickFormatter={(v: number) => fmtUsd(v)}
                tick={{ fill: palette.axis, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={170}
                tickFormatter={(name: string) =>
                  name.length > 24 ? `${name.slice(0, 23)}…` : name
                }
                tick={{ fill: palette.axis, fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: palette.grid, opacity: 0.6 }}
                content={({ active, payload }) => {
                  const k = payload?.[0]?.payload as KeyStats | undefined;
                  if (!k) return null;
                  return (
                    <ChartTooltip
                      active={active}
                      title={`${k.name} (${k.key_prefix}…)`}
                      rows={[
                        { label: 'Cost', color: palette.series[0]!, value: fmtUsd(k.cost_usd) },
                        { label: 'Tokens', color: 'transparent', value: fmtCount(k.tokens) },
                        { label: 'Requests', color: 'transparent', value: fmtCount(k.requests) },
                      ]}
                    />
                  );
                }}
              />
              <Bar
                dataKey="cost_usd"
                fill={palette.series[0]}
                radius={[0, 4, 4, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        )
      }
      table={
        <table>
          <thead>
            <tr>
              <th>Key</th>
              <th className="num">Requests</th>
              <th className="num">Tokens</th>
              <th className="num">Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td className="num">{fmtCount(k.requests)}</td>
                <td className="num">{fmtCount(k.tokens)}</td>
                <td className="num">{fmtUsd(k.cost_usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    />
  );
}
