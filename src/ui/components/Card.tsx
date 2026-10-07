import type { AriaRole, JSX, ReactNode } from 'react';

export function Card({
  variant = 'filled',
  onClick,
  label,
  role,
  children,
}: {
  variant?: 'filled' | 'tonal' | 'error';
  onClick?(): void;
  label?: string;
  role?: AriaRole;
  children: ReactNode;
}): JSX.Element {
  const className = `nr-card nr-card--${variant}${onClick ? ' nr-card--interactive' : ''}`;
  if (onClick)
    return (
      <button type="button" className={className} aria-label={label} onClick={onClick}>
        {children}
      </button>
    );
  return (
    <section className={className} aria-label={label} role={role}>
      {children}
    </section>
  );
}
