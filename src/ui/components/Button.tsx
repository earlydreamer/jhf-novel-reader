import type { ButtonHTMLAttributes, JSX } from 'react';
import { Icon, type IconName } from './Icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant: 'filled' | 'tonal' | 'outlined' | 'text';
  size?: 'm' | 's';
  tone?: 'danger';
  icon?: IconName;
}
export function Button({
  variant,
  size = 's',
  tone,
  icon,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps): JSX.Element {
  const classes = ['nr-button', `nr-button--${variant}`, `nr-button--${size}`];
  if (tone) classes.push(`nr-button--${tone}`);
  if (className) classes.push(className);
  return (
    <button type={type} className={classes.join(' ')} {...rest}>
      {icon && <Icon name={icon} size={size === 'm' ? 24 : 18} />}
      <span className="nr-button__label">{children}</span>
    </button>
  );
}
