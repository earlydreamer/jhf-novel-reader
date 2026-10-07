import { useId, type JSX } from 'react';
import './components.css';

export function Switch({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange(checked: boolean): void;
}): JSX.Element {
  const id = useId();
  // 설명은 label 밖에 둔다. label 안에 있으면 접근성 이름에 설명이 섞인다.
  return (
    <div className="nr-switch-row">
      <span className="nr-switch-row__text">
        <label htmlFor={id} className="nr-switch-row__label">
          {label}
        </label>
        {description && (
          <span id={`${id}-description`} className="nr-switch-row__description">
            {description}
          </span>
        )}
      </span>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="nr-switch"
        checked={checked}
        aria-describedby={description ? `${id}-description` : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
    </div>
  );
}
