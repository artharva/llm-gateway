import type { Range } from './api';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('en');

export const fmtCount = (n: number) => (n < 10_000 ? whole.format(n) : compact.format(n));
export const fmtMs = (n: number | null) =>
  n === null ? '–' : n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`;
export const fmtPct = (part: number, total: number) =>
  total === 0 ? '–' : `${((100 * part) / total).toFixed(1)}%`;

export function fmtUsd(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function fmtTime(iso: string, range: Range): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (range !== '7d') return time;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${time}`;
}
