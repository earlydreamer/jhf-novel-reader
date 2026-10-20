import type { ChapterUpdateStatus } from '../app/chapterUpdates';
import './chapter-updates.css';

export function NewChapterBadge({ count }: { count: number }) {
  return count > 0 ? (
    <span lang="ko" className="nr-new-chapter-badge">
      새 회차 {count}
    </span>
  ) : null;
}

export function ChapterUpdateStatus({ status }: { status?: ChapterUpdateStatus }) {
  return (
    <div className="nr-chapter-update-control">
      <NewChapterBadge count={status?.newChapterIds.length ?? 0} />
      <p role="status">
        {status ? `마지막 검사일: ${status.lastCheckDate}` : '아직 새 회차를 검사하지 않았어요.'}
        {status?.error && <span className="nr-library__update-error">{status.error}</span>}
        {status?.checkedAt != null && (
          <span className="nr-chapter-update-success">
            마지막 성공:{' '}
            {new Date(status.checkedAt).toLocaleString('ko-KR', {
              month: 'long',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </span>
        )}
      </p>
    </div>
  );
}
