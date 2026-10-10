import { fmtCount } from '../format';
import type { Palette } from '../theme';

/** Month-to-date tokens against the key's budget. A budget of 0 means unlimited. */
export function BudgetMeter({
  used,
  budget,
  palette,
}: {
  used: number;
  budget: number;
  palette: Palette;
}) {
  if (budget === 0) return <span className="meta">{fmtCount(used)} used · no limit</span>;
  const ratio = used / budget;
  const color = ratio >= 1 ? palette.critical : ratio >= 0.8 ? palette.warning : palette.good;
  return (
    <div className="meter" title={`${fmtCount(used)} of ${fmtCount(budget)} tokens this month`}>
      <div
        className="track"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={budget}
        aria-valuenow={used}
      >
        <div
          className="fill"
          style={{ width: `${Math.min(100, ratio * 100)}%`, background: color }}
        />
      </div>
      <span className="pct">{Math.round(ratio * 100)}%</span>
    </div>
  );
}
