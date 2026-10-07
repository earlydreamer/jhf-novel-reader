import { useState, type JSX } from 'react';
import type { CompletedTranslation } from '../contracts/reading';
import { japaneseBlockIndexes } from '../translation/quality';
export function ParagraphRetryPanel(props: {
  version: CompletedTranslation;
  disabled?: boolean;
  onRetry(indexes: readonly number[]): void;
}): JSX.Element | null {
  const candidates = props.version.source.paragraphs.flatMap((p, index) =>
    p.text.trim() ? [index] : [],
  );
  const failed = [
    ...new Set([
      ...(props.version.failedParagraphs ?? []),
      ...(props.version.quality?.japaneseBlocks ?? japaneseBlockIndexes(props.version.blocks)),
    ]),
  ]
    .filter((index) => candidates.includes(index))
    .sort((a, b) => a - b);
  const [chosen, setChosen] = useState(candidates[0] ?? 0);
  if (props.version.blocks.length !== props.version.source.paragraphs.length) return null;
  return (
    <section aria-label="문단 재번역" className="nr-paragraph-retry">
      {failed.length > 0 && (
        <p role="status">
          번역 확인이 필요한 문단 {failed.length}개.
          <button disabled={props.disabled} onClick={() => props.onRetry(failed)}>
            실패 문단 다시 번역
          </button>
        </p>
      )}
      <details>
        <summary>문단을 골라 다시 번역</summary>
        <p>선택한 문단만 현재 로컬 모델로 다시 번역하고 새 저장본으로 남깁니다.</p>
        <label>
          재번역할 문단
          <select
            value={chosen}
            onChange={(event) => setChosen(Number(event.target.value))}
            disabled={props.disabled}
          >
            {candidates.map((index) => (
              <option key={index} value={index}>
                {index + 1}번째 · {props.version.blocks[index]!.text.slice(0, 45)}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={props.disabled || !candidates.length}
          onClick={() => props.onRetry([chosen])}
        >
          선택 문단 다시 번역
        </button>
        {failed.map((index) => (
          <button key={index} disabled={props.disabled} onClick={() => props.onRetry([index])}>
            {index + 1}번째 문단 다시 번역
          </button>
        ))}
      </details>
    </section>
  );
}
