import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Range, TimePoint } from '../api';
import { fmtMs, fmtTime } from '../format';
import type { Palette } from '../theme';
import { ChartCard, Empty, Legend, type LegendItem } from './Card';
import { ChartTooltip } from './ChartTooltip';

export function LatencyChart({
  points,
  range,
  palette,
}: {
  points: TimePoint[] | undefined;
  range: Range;
  palette: Palette;
}) {
  const rows = (points ?? []).filter((p) => p.p50_ms !== null);
  const items: LegendItem[] = [
    { label: 'p50', color: palette.series[0]!, shape: 'line' },
    { label: 'p95', color: palette.series[0]!, shape: 'dashed' },
  ];

  return (
    <ChartCard
      className="span-5"
      title="Latency"
      subtitle="Successful requests, including cache hits."
      legend={<Legend items={items} />}
      chart={
        rows.length === 0 ? (
          <Empty>No successful requests in this range yet.</Empty>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -4 }}>
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
                tickFormatter={(v: number) => fmtMs(v)}
                tick={{ fill: palette.axis, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={60}
              />
              <Tooltip
                cursor={{ stroke: palette.axis, strokeWidth: 1, strokeDasharray: '3 3' }}
                content={({ active, payload }) => {
                  const row = payload?.[0]?.payload as TimePoint | undefined;
                  if (!row) return null;
                  return (
                    <ChartTooltip
                      active={active}
                      title={fmtTime(row.ts, range)}
                      rows={[
                        { ...items[0]!, value: fmtMs(row.p50_ms) },
                        { ...items[1]!, value: fmtMs(row.p95_ms) },
                      ]}
                    />
                  );
                }}
              />
              <Line
                type="monotone"
                dataKey="p50_ms"
                stroke={palette.series[0]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, stroke: palette.panel, strokeWidth: 2 }}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="p95_ms"
                stroke={palette.series[0]}
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
                activeDot={{ r: 4, stroke: palette.panel, strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )
      }
      table={
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th className="num">p50</th>
              <th className="num">p95</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ts}>
                <td>{fmtTime(r.ts, range)}</td>
                <td className="num">{fmtMs(r.p50_ms)}</td>
                <td className="num">{fmtMs(r.p95_ms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    />
  );
}
