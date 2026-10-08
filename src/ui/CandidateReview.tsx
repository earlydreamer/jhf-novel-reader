import { useState, type JSX } from 'react';
import type { CandidateChoice } from '../translation/batch';
import type { NameCandidate } from '../translation/scan';

export function CandidateReview({
  candidates,
  disabled,
  onConfirm,
}: {
  candidates: readonly NameCandidate[];
  disabled: boolean;
  onConfirm?(choices: readonly CandidateChoice[]): void;
}): JSX.Element {
  const [targets, setTargets] = useState(new Map<string, string>());
  const [chosen, setChosen] = useState(new Map<string, boolean>());
  const [page, setPage] = useState(0);
  const selected = candidates.filter((candidate) => chosen.get(candidate.source));
  const pageSize = 20;
  return (
    <section aria-label="고유명사 후보 확인">
      <h3>고유명사 후보 {candidates.length}개</h3>
      <p>
        루비와 반복되는 카타카나에서 후보를 찾았어요. 일반 단어도 섞일 수 있어요. 사용할 항목만
        선택하고 한국어 표기를 직접 입력해 주세요. 선택하지 않은 후보는 번역에 적용하지 않아요.
      </p>
      {!candidates.length && <p>새 후보가 없어요. 확인을 마치면 번역을 시작할 수 있어요.</p>}
      <fieldset disabled={disabled}>
        <legend>이번 범위에서 확정할 표기</legend>
        {candidates.slice(page * pageSize, (page + 1) * pageSize).map((candidate) => (
          <div className="nr-candidate" key={candidate.source}>
            <label>
              <input
                type="checkbox"
                checked={!!chosen.get(candidate.source)}
                onChange={(event) =>
                  setChosen(new Map(chosen).set(candidate.source, event.target.checked))
                }
              />
              {candidate.source} 사용
            </label>
            <p>
              {candidate.reading ? `읽기: ${candidate.reading} · ` : ''}
              {candidate.count}회 등장 · {candidate.chapterIds.length}개 회차 ·{' '}
              {candidate.kind === 'ruby' ? '루비 표기' : '카타카나 반복'}
            </p>
            <label>
              {candidate.source} 한국어 표기
              <input
                maxLength={80}
                value={targets.get(candidate.source) ?? ''}
                onChange={(event) =>
                  setTargets(new Map(targets).set(candidate.source, event.target.value))
                }
              />
            </label>
          </div>
        ))}
        {candidates.length > pageSize && (
          <nav aria-label="후보 페이지">
            <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
              이전 후보
            </button>
            <span>
              {page + 1}/{Math.ceil(candidates.length / pageSize)}
            </span>
            <button
              type="button"
              disabled={(page + 1) * pageSize >= candidates.length}
              onClick={() => setPage(page + 1)}
            >
              다음 후보
            </button>
          </nav>
        )}
        {selected.length > 0 ? (
          <button
            disabled={selected.some((candidate) => !targets.get(candidate.source)?.trim())}
            onClick={() =>
              onConfirm?.(
                selected.map((candidate) => ({
                  source: candidate.source,
                  target: targets.get(candidate.source)!.trim(),
                })),
              )
            }
          >
            선택한 {selected.length}개 표기 확정
          </button>
        ) : (
          <button onClick={() => onConfirm?.([])}>
            {candidates.length ? '새 후보를 사용하지 않고 확인 완료' : '후보 확인 완료'}
          </button>
        )}
      </fieldset>
    </section>
  );
}
