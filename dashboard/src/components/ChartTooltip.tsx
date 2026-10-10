import type { LegendItem } from './Card';

export interface TooltipRow extends LegendItem {
  value: string;
}

interface Props {
  active?: boolean;
  title: string;
  rows: TooltipRow[];
  footer?: string;
}

export function ChartTooltip({ active, title, rows, footer }: Props) {
  if (!active) return null;
  return (
    <div className="tooltip">
      <div className="title">{title}</div>
      {rows.map((r) => (
        <div className="row" key={r.label}>
          <span className="name">
            <i
              className={`swatch ${r.shape === 'line' ? 'line' : ''} ${r.shape === 'dashed' ? 'line dashed' : ''}`}
              style={r.shape === 'dashed' ? { color: r.color } : { background: r.color }}
            />
            {r.label}
          </span>
          <span className="v">{r.value}</span>
        </div>
      ))}
      {footer && (
        <div className="meta" style={{ marginTop: 4 }}>
          {footer}
        </div>
      )}
    </div>
  );
}
