import type { JSX } from 'react';

export function Chip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected?: boolean;
  onClick?(): void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`nr-chip${selected ? ' nr-chip--selected' : ''}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
