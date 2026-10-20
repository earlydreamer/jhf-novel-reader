import { useId, useState } from 'react';
import { MAX_CHAPTER_UPDATE_DAYS, validChapterUpdateDays } from '../app/chapterUpdateSchedule';
import { Button } from './components/Button';
import './chapter-updates.css';

export function ChapterUpdateSettings({
  days,
  onSave,
}: {
  days: number;
  onSave(days: number): void;
}) {
  const [draft, setDraft] = useState(String(days));
  const helpId = useId();
  const value = Number(draft);
  const valid = validChapterUpdateDays(value);
  return (
    <form
      className="nr-chapter-update-settings"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onSave(value);
      }}
    >
      <label>
        자동 검사 주기 (일)
        <input
          type="number"
          min={1}
          max={MAX_CHAPTER_UPDATE_DAYS}
          step={1}
          required
          value={draft}
          aria-describedby={helpId}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <Button variant="outlined" type="submit" disabled={!valid || value === days}>
        주기 저장
      </Button>
      <p id={helpId}>
        1~{MAX_CHAPTER_UPDATE_DAYS}일로 설정해요. 작품별 마지막 검사 날짜에서 설정한 일수 뒤 0시가
        기준이에요. 실패한 검사도 날짜에 포함해요.
      </p>
      <p>
        앱을 닫아 두었다면 다음 실행·복귀 때 검사해요. 서재 전체·작품별 수동 검사는 언제든 할 수
        있어요.
      </p>
    </form>
  );
}
