import type { BreakerState } from '../api';

type Tone = 'good' | 'warning' | 'critical' | 'muted';

const ICONS: Record<Tone, string> = {
  good: 'M3 8.5l3 3 7-7', // check
  warning: 'M8 3v6M8 12v1', // exclamation
  critical: 'M4 4l8 8M12 4l-8 8', // cross
  muted: 'M4 8h8', // dash
};

/** Status always travels as icon + label, never color alone. */
export function Badge({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className={`badge ${tone}`}>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d={ICONS[tone]} />
      </svg>
      {label}
    </span>
  );
}

export function BreakerBadge({ state }: { state: BreakerState }) {
  if (state === 'open') return <Badge tone="critical" label="Open" />;
  if (state === 'half_open') return <Badge tone="warning" label="Half-open" />;
  return <Badge tone="good" label="Closed" />;
}
