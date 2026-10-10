import { useState, type ReactNode } from 'react';

interface CardProps {
  title: string;
  subtitle?: string;
  className?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function Card({ title, subtitle, className, actions, children }: CardProps) {
  return (
    <section className={`card ${className ?? ''}`}>
      <div className="card-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="spacer" />
        {actions}
      </div>
      {children}
    </section>
  );
}

interface ChartCardProps extends Omit<CardProps, 'children' | 'actions'> {
  chart: ReactNode;
  table: ReactNode;
  legend?: ReactNode;
}

/** A chart with a "Table" toggle, so every number is readable without color. */
export function ChartCard({ chart, table, legend, ...card }: ChartCardProps) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card
      {...card}
      actions={
        <button className="link-button" onClick={() => setAsTable((t) => !t)}>
          {asTable ? 'Show chart' : 'Show table'}
        </button>
      }
    >
      {asTable ? (
        <div className="table-wrap">{table}</div>
      ) : (
        <>
          {legend}
          {chart}
        </>
      )}
    </Card>
  );
}

export interface LegendItem {
  label: string;
  color: string;
  shape?: 'box' | 'line' | 'dashed';
}

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <div className="legend">
      {items.map((it) => (
        <span key={it.label}>
          <i
            className={`swatch ${it.shape === 'line' ? 'line' : ''} ${it.shape === 'dashed' ? 'line dashed' : ''}`}
            style={it.shape === 'dashed' ? { color: it.color } : { background: it.color }}
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
