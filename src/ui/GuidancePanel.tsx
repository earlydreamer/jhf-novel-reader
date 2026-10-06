import { useEffect, useState, type JSX } from 'react';
import type { GuidanceDraft, WorkGuidance } from '../translation/guidance';

export interface GuidancePanelProps {
  workId: string;
  locked: boolean;
  onRead(workId: string): Promise<WorkGuidance | null>;
  onSave(workId: string, draft: GuidanceDraft): Promise<WorkGuidance>;
}
const aliases = (value: string) => value.split(/[,、]/).map((name) => name.trim());
export function GuidancePanel({ workId, locked, onRead, onSave }: GuidancePanelProps): JSX.Element {
  const [draft, setDraft] = useState<GuidanceDraft>({ terms: [], voices: [] });
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let mounted = true;
    void onRead(workId)
      .then((value) => {
        if (!mounted) return;
        setDraft({ terms: value?.terms ?? [], voices: value?.voices ?? [] });
        setAvailable(true);
      })
      .catch(() => {
        if (mounted)
          setMessage('저장한 용어집을 읽지 못했습니다. 기존 데이터를 덮어쓰지 않습니다.');
      })
      .finally(() => {
        if (mounted) setBusy(false);
      });
    return () => {
      mounted = false;
    };
  }, [workId, onRead]);
  function change(next: GuidanceDraft) {
    setDraft(next);
    setMessage('변경 사항을 저장해야 번역에 적용됩니다.');
  }
  async function save() {
    setBusy(true);
    try {
      const value = await onSave(workId, {
        terms: draft.terms.map((term) => ({ ...term, aliases: term.aliases.filter(Boolean) })),
        voices: draft.voices.map((voice) => ({ ...voice, aliases: voice.aliases.filter(Boolean) })),
      });
      setDraft({ terms: value.terms, voices: value.voices });
      setMessage('저장했습니다. 다음 번역에 적용되며 기존 번역은 그대로 남습니다.');
    } catch {
      setMessage(
        '저장하지 못했습니다. 필수 항목과 글자 수·별칭 수를 확인하세요. 입력은 그대로 남아 있습니다.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="nr-guidance-panel">
      <summary>작품 용어집·캐릭터 말투</summary>
      <p>
        이 작품에서 직접 저장한 항목 중 원문에 이름·별칭이 등장하는 항목만 적용합니다. 로컬 모델
        번역에 사용하며, 화자가 불확실한 대사는 추측하지 않도록 전달합니다. 긴 용어집으로 입력
        예산이 부족하면 항목을 줄인 뒤 다시 시작하세요.
      </p>
      <p>
        용어는 40개, 캐릭터는 20개까지 저장할 수 있습니다. 원문·표기·이름은 80자, 분류는 40자,
        설명은 300자, 말투 지침은 400자까지 입력하세요.
      </p>
      <fieldset disabled={busy || locked || !available}>
        <legend>용어집</legend>
        {draft.terms.map((term, index) => (
          <fieldset key={index}>
            <legend>용어 {index + 1}</legend>
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
                        i === index ? { ...entry, [key]: event.target.value } : entry,
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
                      i === index ? { ...entry, aliases: aliases(event.target.value) } : entry,
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
          disabled={draft.terms.length >= 40}
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
          disabled={draft.voices.length >= 20}
          onClick={() =>
            change({
              ...draft,
              voices: [...draft.voices, { name: '', aliases: [], instruction: '' }],
            })
          }
        >
          캐릭터 추가
        </button>
        <button type="button" onClick={() => void save()}>
          용어집·말투 저장
        </button>
      </fieldset>
      {busy && <p>용어집 처리 중…</p>}
      {message && <p role="status">{message}</p>}
    </details>
  );
}
