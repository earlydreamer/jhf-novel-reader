import { useState, type JSX } from 'react';
import { displayedTitle, type SavedTitle } from '../translation/titles';

export interface TitleControls {
  entries: readonly SavedTitle[];
  busy: boolean;
  onTranslate(key?: string): Promise<void>;
  onSave(key: string, target: string): Promise<void>;
}
export function TitleHeading({
  titleKey,
  source,
  label,
  controls,
  original = false,
  inline = false,
}: {
  titleKey: string;
  source: string;
  label: string;
  controls?: TitleControls;
  original?: boolean;
  inline?: boolean;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const translated = displayedTitle(controls?.entries ?? [], titleKey, source);
  const entry = controls?.entries.find(
    (entry) => entry.key === titleKey && entry.source === source,
  );
  const title = original ? source : translated;
  async function save() {
    if (!controls || !draft.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await controls.onSave(titleKey, draft.trim());
      setEditing(false);
    } catch {
      setError('제목을 저장하지 못했어. 입력한 내용은 그대로 남겨 뒀어.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="nr-title" aria-label={label}>
      {!inline && <h1>{title}</h1>}
      {controls && (
        <div className="nr-title-actions">
          <button
            aria-label={`${label} ${entry ? '재번역' : '번역'}`}
            disabled={controls.busy || saving}
            onClick={() => void controls.onTranslate(titleKey)}
          >
            {entry ? '제목 재번역' : '제목 번역'}
          </button>
          <button
            aria-label={`${label} 수정`}
            disabled={saving}
            onClick={() => {
              setDraft(translated);
              setError(null);
              setEditing(true);
            }}
          >
            제목 수정
          </button>
          {entry?.origin === 'user' && <span>직접 수정됨</span>}
        </div>
      )}
      {editing && (
        <form
          aria-label={`${label} 편집`}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <p lang="ja">원제: {source}</p>
          <label>
            {label} 번역문
            <input
              value={draft}
              maxLength={4096}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <button type="submit" disabled={saving || !draft.trim()}>
            제목 저장
          </button>
          <button type="button" disabled={saving} onClick={() => setEditing(false)}>
            취소
          </button>
          {error && <p role="alert">{error}</p>}
        </form>
      )}
    </div>
  );
}
