import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Range, TimePoint } from '../api';
import { fmtCount, fmtTime } from '../format';
import type { Palette } from '../theme';
import { ChartCard, Empty, Legend, type LegendItem } from './Card';
import { ChartTooltip } from './ChartTooltip';

interface Row {
  ts: string;
  provider: number;
  cache: number;
  limited: number;
  failed: number;
  requests: number;
}

const SERIES = [
  { key: 'provider', label: 'Served by a provider' },
  { key: 'cache', label: 'Served from cache' },
  { key: 'limited', label: 'Rate-limited (429)' },
  { key: 'failed', label: 'Failed (5xx)' },
] as const;

export function TrafficChart({
  points,
  range,
  palette,
}: {
  points: TimePoint[] | undefined;
  range: Range;
  palette: Palette;
}) {
  const rows: Row[] = (points ?? []).map((p) => ({
    ts: p.ts,
    provider: p.ok - p.cache_hits,
    cache: p.cache_hits,
    limited: p.limited,
    failed: p.errors,
    requests: p.requests,
  }));
  const items: LegendItem[] = SERIES.map((s, i) => ({ label: s.label, color: palette.series[i]! }));
  const empty = rows.every((r) => r.requests === 0);

  return (
    <ChartCard
      className="span-7"
      title="Requests by outcome"
      subtitle="Per time bucket. Other 4xx (bad requests, auth, budget) are counted in the total only."
      legend={<Legend items={items} />}
      chart={
        empty ? (
          <Empty>No requests in this range yet.</Empty>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={rows}
              margin={{ top: 4, right: 4, bottom: 0, left: -12 }}
              barCategoryGap="12%"
            >
              <CartesianGrid vertical={false} stroke={palette.grid} />
              <XAxis
                dataKey="ts"
                tickFormatter={(t: string) => fmtTime(t, range)}
                tick={{ fill: palette.axis, fontSize: 11 }}
                axisLine={{ stroke: palette.grid }}
                tickLine={false}
                minTickGap={24}
              />
              <YAxis
                tickFormatter={(v: number) => fmtCount(v)}
                tick={{ fill: palette.axis, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                cursor={{ fill: palette.grid, opacity: 0.6 }}
                content={({ active, payload }) => {
                  const row = payload?.[0]?.payload as Row | undefined;
                  if (!row) return null;
                  return (
                    <ChartTooltip
                      active={active}
                      title={fmtTime(row.ts, range)}
                      rows={SERIES.map((s, i) => ({ ...items[i]!, value: fmtCount(row[s.key]) }))}
                      footer={`${fmtCount(row.requests)} requests in total`}
                    />
                  );
                }}
              />
              {SERIES.map((s, i) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  stackId="traffic"
                  fill={palette.series[i]}
                  stroke={palette.panel}
                  strokeWidth={1}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )
      }
      table={
        <table>
          <thead>
            <tr>
              <th>Time</th>
              {SERIES.map((s) => (
                <th className="num" key={s.key}>
                  {s.label}
                </th>
              ))}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((r) => r.requests > 0)
              .map((r) => (
                <tr key={r.ts}>
                  <td>{fmtTime(r.ts, range)}</td>
                  {SERIES.map((s) => (
                    <td className="num" key={s.key}>
                      {fmtCount(r[s.key])}
                    </td>
                  ))}
                  <td className="num">{fmtCount(r.requests)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      }
    />
  );
}
