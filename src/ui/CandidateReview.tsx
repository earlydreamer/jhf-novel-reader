import { useState, type JSX } from 'react';
import type { CandidateChoice } from '../translation/batch';
import type { NameCandidate } from '../translation/scan';
import type { TermScanChange } from '../translation/termScanRun';
import { ConfidenceBadges } from './TermScanPanel';

export function CandidateReview({
  candidates,
  disabled,
  onConfirm,
  suggestions,
  common,
}: {
  candidates: readonly NameCandidate[];
  disabled: boolean;
  onConfirm?(choices: readonly CandidateChoice[]): void;
  /** 정밀스캔 채우기의 제안. 배열이 새로 들어올 때마다 한 번 적용한다. */
  suggestions?: readonly TermScanChange[];
  /** 정밀스캔이 일반어로 판정한 이름. 표시만 하고 체크하지 않는다. */
  common?: readonly string[];
}): JSX.Element {
  const [targets, setTargets] = useState(new Map<string, string>());
  const [chosen, setChosen] = useState(new Map<string, boolean>());
  // 사용자가 직접 고친 표기와 직접 바꾼 체크. 다시 채우기에서도 그대로 둔다.
  const [edited, setEdited] = useState(new Set<string>());
  const [toggled, setToggled] = useState(new Set<string>());
  // 정밀스캔이 자동으로 넣은 표기. 다음 결과에서 일반어로 바뀌면 이 값과 같을 때만 지운다.
  const [autoFilled, setAutoFilled] = useState(new Map<string, string>());
  const [applied, setApplied] = useState<readonly TermScanChange[] | undefined>(undefined);
  const [page, setPage] = useState(0);
  // 렌더 중 이전 참조와 비교해 새 제안이 들어왔을 때만 한 번 적용한다(effect 안 setState를 쓰지 않는다).
  if (suggestions !== applied) {
    setApplied(suggestions);
    if (suggestions) {
      const nextTargets = new Map(targets);
      const nextChosen = new Map(chosen);
      const nextAuto = new Map(autoFilled);
      const suggested = new Set<string>();
      for (const item of suggestions) {
        suggested.add(item.source);
        if (!edited.has(item.source)) {
          nextTargets.set(item.source, item.after);
          nextAuto.set(item.source, item.after);
        }
        // 낮은 신뢰도는 사람이 확인하도록 체크하지 않는다.
        if (!toggled.has(item.source)) nextChosen.set(item.source, item.confidence !== 'low');
      }
      // 제안이 빠진 후보(일반어이거나 답 없음)는 자동으로 넣은 표기를 지우고 체크를 푼다.
      // 사용자가 고친 표기와 직접 바꾼 체크는 그대로 둔다.
      for (const candidate of candidates) {
        const { source } = candidate;
        if (suggested.has(source)) continue;
        if (
          !edited.has(source) &&
          nextAuto.has(source) &&
          nextTargets.get(source) === nextAuto.get(source)
        ) {
          nextTargets.delete(source);
          nextAuto.delete(source);
        }
        if (!toggled.has(source)) nextChosen.set(source, false);
      }
      setTargets(nextTargets);
      setChosen(nextChosen);
      setAutoFilled(nextAuto);
    }
  }
  const suggestionBySource = new Map((suggestions ?? []).map((item) => [item.source, item]));
  const commonNames = new Set(common ?? []);
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
        {candidates.slice(page * pageSize, (page + 1) * pageSize).map((candidate) => {
          const suggestion = suggestionBySource.get(candidate.source);
          return (
            <div className="nr-candidate" key={candidate.source}>
              <label>
                <input
                  type="checkbox"
                  checked={!!chosen.get(candidate.source)}
                  onChange={(event) => {
                    setChosen(new Map(chosen).set(candidate.source, event.target.checked));
                    setToggled(new Set(toggled).add(candidate.source));
                  }}
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
                  onChange={(event) => {
                    setTargets(new Map(targets).set(candidate.source, event.target.value));
                    setEdited(new Set(edited).add(candidate.source));
                  }}
                />
              </label>
              {suggestion && (
                <>
                  <ConfidenceBadges change={suggestion} />
                  <p>{suggestion.reason}</p>
                </>
              )}
              {commonNames.has(candidate.source) && <p>일반어로 판정했어요</p>}
            </div>
          );
        })}
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
