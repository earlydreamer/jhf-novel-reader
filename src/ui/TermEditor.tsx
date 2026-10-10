import { useMemo, useState, type JSX } from 'react';
import type { GuidanceTerm } from '../translation/guidance';
import { Button } from './components/Button';
import { Chip } from './components/Chip';
import { Dialog } from './components/Modal';
import { sourceChips, termProblem } from './readerGlossary';

export interface TermEditorProps {
  open: boolean;
  mode: 'add' | 'edit';
  /** 편집이면 고칠 항목, 추가면 undefined */
  initial?: GuidanceTerm;
  /** 추가 모드에서 칩을 뽑을 원문 문단 */
  sourceText?: string;
  terms: readonly GuidanceTerm[];
  locked: boolean;
  onCancel(): void;
  onSave(term: GuidanceTerm, previousSource?: string): Promise<void> | void;
}

/** 리더에서 용어를 추가하거나 고치는 대화상자. 저장 전 검사는 termProblem이 맡는다. */
export function TermEditor({
  open,
  mode,
  initial,
  sourceText,
  terms,
  locked,
  onCancel,
  onSave,
}: TermEditorProps): JSX.Element | null {
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [category, setCategory] = useState('');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [basis, setBasis] = useState<{ open: boolean; initial?: GuidanceTerm }>();
  // 열리거나 고칠 항목이 바뀌면 입력값을 항목에 맞춘다. 이펙트 대신 렌더 중에 다시 맞춰 한 번 더 그리지 않게 한다.
  if (!basis || basis.open !== open || basis.initial !== initial) {
    setBasis({ open, initial });
    setSource(initial?.source ?? '');
    setTarget(initial?.target ?? '');
    setCategory(initial?.category ?? '');
    setNote(initial?.note ?? '');
    setProblem(null);
  }
  const chips = useMemo(
    () => (mode === 'add' ? sourceChips(sourceText ?? '') : []),
    [mode, sourceText],
  );
  if (!open) return null;

  async function submit(): Promise<void> {
    const message = termProblem(terms, { source, target }, initial?.source);
    if (message) {
      setProblem(message);
      return;
    }
    setProblem(null);
    setSaving(true);
    try {
      await onSave(
        {
          source: source.trim(),
          target: target.trim(),
          aliases: [...(initial?.aliases ?? [])],
          category: category.trim(),
          note: note.trim(),
        },
        initial?.source,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      title={mode === 'add' ? '용어 추가하기' : '용어 편집하기'}
      onClose={onCancel}
      actions={
        <>
          <Button variant="text" onClick={onCancel}>
            취소
          </Button>
          <Button variant="filled" disabled={locked || saving} onClick={() => void submit()}>
            저장
          </Button>
        </>
      }
    >
      {mode === 'add' && chips.length > 0 && (
        <>
          <p>원문 문단에서 이름을 골라 넣을 수 있어요.</p>
          <div className="nr-term-chips" lang="ja">
            {chips.map((chip) => (
              <Chip
                key={chip}
                label={chip}
                selected={source === chip}
                onClick={() => setSource(chip)}
              />
            ))}
          </div>
        </>
      )}
      {locked && <p role="status">번역 중에는 용어집을 고칠 수 없어요.</p>}
      <label>
        원문
        <input
          lang="ja"
          maxLength={80}
          value={source}
          onChange={(event) => setSource(event.target.value)}
        />
      </label>
      <label>
        번역 표기
        <input maxLength={80} value={target} onChange={(event) => setTarget(event.target.value)} />
      </label>
      <label>
        분류 (선택)
        <input
          maxLength={40}
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        />
      </label>
      <label>
        메모 (선택)
        <textarea maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      {problem && <p role="alert">{problem}</p>}
    </Dialog>
  );
}
