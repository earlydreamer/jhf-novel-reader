import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import {
  GuidanceConflictError,
  isUnsafeTermName,
  type GuidanceDraft,
  type GuidanceTerm,
  type WorkGuidance,
} from '../translation/guidance';

/** 원문이나 별칭에 번역 제외 대상(한 글자·짧은 히라가나)이 있는지. 아직 비어 있는 입력칸은 세지 않는다. */
const hasUnsafeName = (term: GuidanceTerm) =>
  [term.source, ...term.aliases].some((name) => name.trim() && isUnsafeTermName(name));

/** 사람이 고친 항목은 출처와 근거를 지워 기계가 덮어쓰지 않는 사람 항목이 된다. 'auto'는 기존 동작을 유지한다. */
function humanized(term: GuidanceTerm): GuidanceTerm {
  if (term.origin !== 'model' && term.origin !== 'scan') return term;
  return {
    source: term.source,
    target: term.target,
    aliases: term.aliases,
    category: term.category,
    note: term.note,
  };
}

export interface GuidancePanelProps {
  workId: string;
  locked: boolean;
  refreshKey?: string;
  onRead(workId: string): Promise<WorkGuidance | null>;
  onSave(workId: string, draft: GuidanceDraft, expectedHash?: string | null): Promise<WorkGuidance>;
  onSaved?(value: WorkGuidance): void;
  onStateChange?(state: GuidancePanelState): void;
}
export type GuidancePanelState = { dirty: boolean; saving: boolean; canSave: boolean };
const aliases = (value: string) => value.split(/[,、]/).map((name) => name.trim());
export function GuidancePanel({
  workId,
  locked,
  refreshKey,
  onRead,
  onSave,
  onSaved,
  onStateChange,
}: GuidancePanelProps): JSX.Element {
  const [draft, setDraft] = useState<GuidanceDraft>({ terms: [], voices: [] });
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const [available, setAvailable] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [reload, setReload] = useState(0);
  const baseHash = useRef<string | null>(null);
  const loadKey = `${workId}:${refreshKey ?? ''}:${reload}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const canSave = !busy && !locked && available && loadedKey === loadKey && !conflict;
  useLayoutEffect(() => {
    onStateChange?.({ dirty, saving, canSave });
  }, [dirty, saving, canSave, onStateChange]);
  useEffect(() => {
    if (dirtyRef.current) {
      setConflict(true);
      setMessage('다른 작업에서 용어집이 바뀌었어요. 입력한 내용을 확인한 뒤 다시 읽어 주세요.');
      return;
    }
    let mounted = true;
    setBusy(true);
    setAvailable(false);
    void onRead(workId)
      .then((value) => {
        if (!mounted) return;
        baseHash.current = value?.hash ?? null;
        setDraft({
          terms: value?.terms ?? [],
          voices: value?.voices ?? [],
          ...(value?.plotSummary !== undefined ? { plotSummary: value.plotSummary } : {}),
        });
        setAvailable(true);
        setLoadedKey(loadKey);
      })
      .catch(() => {
        if (mounted) setMessage('저장한 용어집을 읽지 못했어요. 기존 데이터는 덮어쓰지 않아요.');
      })
      .finally(() => {
        if (mounted) setBusy(false);
      });
    return () => {
      mounted = false;
    };
  }, [workId, onRead, loadKey]);
  function change(next: GuidanceDraft) {
    dirtyRef.current = true;
    setDirty(true);
    setDraft(next);
    setMessage('변경 사항을 저장해야 번역에 적용돼요.');
  }
  async function save() {
    if (!canSave || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setBusy(true);
    try {
      const value = await onSave(
        workId,
        {
          ...(draft.plotSummary !== undefined ? { plotSummary: draft.plotSummary } : {}),
          terms: draft.terms.map((term) => ({ ...term, aliases: term.aliases.filter(Boolean) })),
          voices: draft.voices.map((voice) => ({
            ...voice,
            aliases: voice.aliases.filter(Boolean),
          })),
        },
        baseHash.current,
      );
      baseHash.current = value.hash;
      dirtyRef.current = false;
      setDirty(false);
      setDraft({
        terms: value.terms,
        voices: value.voices,
        ...(value.plotSummary !== undefined ? { plotSummary: value.plotSummary } : {}),
      });
      setMessage('저장했어요. 다음 번역부터 적용되고 기존 번역은 그대로 남아요.');
      onSaved?.(value);
    } catch (error) {
      if (error instanceof GuidanceConflictError) {
        setConflict(true);
        setMessage('다른 작업에서 용어집이 바뀌었어요. 입력한 내용을 확인한 뒤 다시 읽어 주세요.');
        return;
      }
      setMessage(
        '저장하지 못했어요. 필수 항목, 글자 수·별칭 수, 중복된 이름을 확인해 주세요. 입력한 내용은 그대로 남아 있어요.',
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
      setBusy(false);
    }
  }
  return (
    <div className="nr-guidance-panel">
      <p>
        이 작품에서 직접 저장한 항목 중 원문에 이름·별칭이 나오는 항목만 적용해요. 로컬 모델 번역에
        쓰고, 화자가 불확실한 대사는 추측하지 않도록 전달해요. 용어집이 길어 입력 예산이 부족하면
        항목을 줄인 뒤 다시 시작해 주세요.
      </p>
      <p>
        저장 개수에는 제한이 없고, 번역 구간에 나온 항목만 전달해요. 원문·표기·이름은 80자, 분류는
        40자, 설명은 300자, 말투 지침은 400자까지 입력할 수 있어요. 같은 이름(전각·반각 차이 포함)은
        한 번만 등록할 수 있어요.
      </p>
      {locked && (
        <p role="status">작업 중에는 용어집을 고칠 수 없어요. 작업이 끝난 뒤 저장해 주세요.</p>
      )}
      <fieldset disabled={!canSave}>
        <legend>용어집</legend>
        <label>
          이전 이야기 요약 (선택, 이름 없이 400자 이내)
          <textarea
            maxLength={400}
            value={draft.plotSummary ?? ''}
            onChange={(event) => change({ ...draft, plotSummary: event.target.value })}
          />
        </label>
        {draft.terms.map((term, index) => (
          <fieldset key={index}>
            <legend>용어 {index + 1}</legend>
            {term.origin === 'model' && <span className="nr-guidance-origin">자동 생성</span>}
            {term.origin === 'scan' && (
              <>
                <span className="nr-guidance-origin">정밀스캔</span>
                {term.evidence?.length ? (
                  <ul className="nr-guidance-evidence">
                    {term.evidence.map((item, evidenceIndex) => (
                      <li key={evidenceIndex}>
                        {item.note}
                        {item.url && (
                          <>
                            {' '}
                            <a href={item.url} target="_blank" rel="noreferrer">
                              출처
                            </a>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
            {hasUnsafeName(term) && (
              <p className="nr-guidance-warning">
                한 글자이거나 짧은 히라가나 원문은 다른 단어 안에도 들어 있어서 번역에 쓰지 않아요.
              </p>
            )}
            {(['source', 'target', 'category', 'note'] as const).map((key) => (
              <label key={key}>
                {{ source: '원문', target: '한국어 표기', category: '분류', note: '설명' }[key]}
                <input
                  aria-label={`용어 ${index + 1} ${{ source: '원문', target: '한국어 표기', category: '분류', note: '설명' }[key]}`}
                  value={term[key]}
                  maxLength={key === 'note' ? 300 : key === 'category' ? 40 : 80}
                  onChange={(event) =>
                    change({
                      ...draft,
                      terms: draft.terms.map((entry, i) =>
                        i === index ? { ...humanized(entry), [key]: event.target.value } : entry,
                      ),
                    })
                  }
                />
              </label>
            ))}
            <label>
              별칭 (쉼표로 구분, 최대 8개)
              <input
                aria-label={`용어 ${index + 1} 별칭`}
                value={term.aliases.join(', ')}
                onChange={(event) =>
                  change({
                    ...draft,
                    terms: draft.terms.map((entry, i) =>
                      i === index
                        ? { ...humanized(entry), aliases: aliases(event.target.value) }
                        : entry,
                    ),
                  })
                }
              />
            </label>
            <button
              type="button"
              onClick={() => change({ ...draft, terms: draft.terms.filter((_, i) => i !== index) })}
            >
              용어 {index + 1} 삭제
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          onClick={() =>
            change({
              ...draft,
              terms: [
                ...draft.terms,
                { source: '', target: '', aliases: [], category: '', note: '' },
              ],
            })
          }
        >
          용어 추가
        </button>
        <h3>캐릭터 말투</h3>
        {draft.voices.map((voice, index) => (
          <fieldset key={index}>
            <legend>캐릭터 {index + 1}</legend>
            <label>
              이름
              <input
                aria-label={`캐릭터 ${index + 1} 이름`}
                maxLength={80}
                value={voice.name}
                onChange={(event) =>
                  change({
                    ...draft,
                    voices: draft.voices.map((entry, i) =>
                      i === index ? { ...entry, name: event.target.value } : entry,
                    ),
                  })
                }
              />
            </label>
            <label>
              별칭 (쉼표로 구분, 최대 8개)
              <input
                aria-label={`캐릭터 ${index + 1} 별칭`}
                value={voice.aliases.join(', ')}
                onChange={(event) =>
                  change({
                    ...draft,
                    voices: draft.voices.map((entry, i) =>
                      i === index ? { ...entry, aliases: aliases(event.target.value) } : entry,
                    ),
                  })
                }
              />
            </label>
            <label>
              말투·호칭 지침
              <textarea
                aria-label={`캐릭터 ${index + 1} 말투`}
                maxLength={400}
                value={voice.instruction}
                onChange={(event) =>
                  change({
                    ...draft,
                    voices: draft.voices.map((entry, i) =>
                      i === index ? { ...entry, instruction: event.target.value } : entry,
                    ),
                  })
                }
              />
            </label>
            <button
              type="button"
              onClick={() =>
                change({ ...draft, voices: draft.voices.filter((_, i) => i !== index) })
              }
            >
              캐릭터 {index + 1} 삭제
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          onClick={() =>
            change({
              ...draft,
              voices: [...draft.voices, { name: '', aliases: [], instruction: '' }],
            })
          }
        >
          캐릭터 추가
        </button>
        <button type="button" data-guidance-save onClick={() => void save()}>
          용어집·말투 저장
        </button>
      </fieldset>
      {busy && <p>용어집 처리 중…</p>}
      {message && <p role="status">{message}</p>}
      {(conflict || (!busy && !available)) && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            dirtyRef.current = false;
            setDirty(false);
            setConflict(false);
            setMessage('');
            setReload((value) => value + 1);
          }}
        >
          {dirty ? '입력한 변경을 버리고 다시 읽기' : '용어집 다시 읽기'}
        </button>
      )}
    </div>
  );
}
