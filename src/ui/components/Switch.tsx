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
  // 행 전체가 label이라 글자와 설명 어디를 눌러도 토글된다. 접근성 이름은 라벨 글자만 쓰고 설명은 description으로 따로 잇는다.
  return (
    <label className="nr-switch-row">
      <span className="nr-switch-row__text">
        <span id={`${id}-label`} className="nr-switch-row__label">
          {label}
        </span>
        {description && (
          <span id={`${id}-description`} className="nr-switch-row__description">
            {description}
          </span>
        )}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="nr-switch"
        checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-description` : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
