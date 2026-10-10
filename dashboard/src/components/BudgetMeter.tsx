import { fmtCount } from '../format';
import type { Palette } from '../theme';

/** Month-to-date tokens against the key's budget. A budget of 0 blocks the key. */
export function BudgetMeter({
  used,
  budget,
  palette,
}: {
  used: number;
  budget: number;
  palette: Palette;
}) {
  const ratio = budget === 0 ? 1 : used / budget;
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
