import './chapter-updates.css';

export function NewChapterBadge({ count }: { count?: number }) {
  return count === undefined || count > 0 ? (
    <span lang="ko" className="nr-new-chapter-badge">
      새 회차{count === undefined ? '' : ` ${count}`}
    </span>
  ) : null;
}
