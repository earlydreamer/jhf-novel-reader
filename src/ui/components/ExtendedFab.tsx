import type { AriaAttributes, JSX, Ref } from 'react';
import { Icon, type IconName } from './Icon';

export function ExtendedFab({
  icon,
  label,
  onClick,
  collapsed = false,
  ref,
  ...aria
}: {
  icon: IconName;
  label: string;
  onClick(): void;
  collapsed?: boolean;
  ref?: Ref<HTMLButtonElement>;
} & Pick<AriaAttributes, 'aria-haspopup' | 'aria-expanded'>): JSX.Element {
  return (
    <button
      ref={ref}
      type="button"
      className={`nr-fab${collapsed ? ' nr-fab--collapsed' : ''}`}
      aria-label={collapsed ? label : undefined}
      onClick={onClick}
      {...aria}
    >
      <Icon name={icon} />
      {!collapsed && <span>{label}</span>}
    </button>
  );
}
