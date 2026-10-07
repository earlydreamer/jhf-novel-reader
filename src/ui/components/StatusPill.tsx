import type { JSX, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function StatusPill({
  icon,
  children,
  action,
}: {
  icon?: IconName;
  children: ReactNode;
  action?: { label: string; onClick(): void };
}): JSX.Element {
  return (
    <div className="nr-status-pill">
      <span role="status" className="nr-status-pill__text">
        {icon && <Icon name={icon} size={18} />}
        {children}
      </span>
      {action && (
        <button type="button" className="nr-status-pill__action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
