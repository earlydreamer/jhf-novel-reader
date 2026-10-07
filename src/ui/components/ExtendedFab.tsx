import type { JSX } from 'react';
import { Icon, type IconName } from './Icon';

export function ExtendedFab({
  icon,
  label,
  onClick,
  collapsed = false,
}: {
  icon: IconName;
  label: string;
  onClick(): void;
  collapsed?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`nr-fab${collapsed ? ' nr-fab--collapsed' : ''}`}
      aria-label={collapsed ? label : undefined}
      onClick={onClick}
    >
      <Icon name={icon} />
      {!collapsed && <span>{label}</span>}
    </button>
  );
}
