import type { ButtonHTMLAttributes, JSX, Ref } from 'react';
import { Icon, type IconName } from './Icon';

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  icon: IconName;
  label: string;
  variant?: 'standard' | 'tonal';
  pressed?: boolean;
  ref?: Ref<HTMLButtonElement>;
}
export function IconButton({
  icon,
  label,
  variant = 'standard',
  pressed,
  className,
  type = 'button',
  ref,
  ...rest
}: IconButtonProps): JSX.Element {
  const classes = ['nr-icon-button', `nr-icon-button--${variant}`];
  if (className) classes.push(className);
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      className={classes.join(' ')}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
}
