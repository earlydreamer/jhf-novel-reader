import type { CSSProperties, JSX } from 'react';
import './components.css';

export function LinearProgress({ label, value }: { label: string; value?: number }): JSX.Element {
  // NaN·Infinity 같은 값은 진행률이 아니므로 비결정형으로 본다.
  const determinate = Number.isFinite(value);
  const clamped = determinate ? Math.min(1, Math.max(0, value ?? 0)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={determinate ? Math.round(clamped * 100) : undefined}
      className={`nr-progress${determinate ? '' : ' nr-progress--indeterminate'}`}
      style={{ '--nr-progress': clamped } as CSSProperties}
    >
      <span className="nr-progress__bar" />
    </div>
  );
}
