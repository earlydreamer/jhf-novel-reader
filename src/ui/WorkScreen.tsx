import type { JSX } from 'react';
import type { ChapterRef, WorkPage } from '../contracts/reading';
import { BatchPanel } from './BatchPanel';
import type { BatchPanelProps } from './BatchPanel';
import { GuidancePanel, type GuidancePanelProps } from './GuidancePanel';
export interface WorkScreenProps extends Omit<BatchPanelProps, 'workId'> {
  work: WorkPage;
  selectedChapterId?: string;
  busy: boolean;
  savedChapterIds: readonly string[];
  onSelect(chapter: ChapterRef): void;
  onLoadMore(): void;
  guidance?: Omit<GuidancePanelProps, 'workId'>;
}
export function WorkScreen({
  work,
  selectedChapterId,
  savedChapterIds,
  busy,
  onSelect,
  onLoadMore,
  batch,
  batchAvailable,
  onPrepareBatch,
  onRunBatch,
  onCancelBatch,
  onRetryBatchSave,
  onSettings,
  guidance,
}: WorkScreenProps): JSX.Element {
  return (
    <section aria-label="작품 목차">
      <h1>{work.title}</h1>
      <a href={work.canonicalUrl} target="_blank" rel="noreferrer">
        작품 원문
      </a>
      <h2>목차</h2>
      {guidance && <GuidancePanel key={work.workId} workId={work.workId} {...guidance} />}
      <BatchPanel
        workId={work.workId}
        batch={batch}
        batchAvailable={batchAvailable}
        onPrepareBatch={onPrepareBatch}
        onRunBatch={onRunBatch}
        onCancelBatch={onCancelBatch}
        onRetryBatchSave={onRetryBatchSave}
        onSettings={onSettings}
      />
      <a href={work.pageUrl} target="_blank" rel="noreferrer">
        현재 목차 원문
      </a>
      {work.chapters.length > 0 && (
        <p>
          현재 확인한 범위: {work.chapters[0]!.ordinal}–
          {work.chapters[work.chapters.length - 1]!.ordinal}화 ({work.chapters.length}개 회차)
        </p>
      )}
      <p>
        {work.complete
          ? `확인된 전체 목차 (총 ${work.chapters[work.chapters.length - 1]?.ordinal ?? 0}화)`
          : '일부 목차입니다. 전체 목록은 아직 확인하지 않았습니다.'}
      </p>
      <ol start={work.chapters[0]?.ordinal || 1}>
        {work.chapters.map((chapter) => (
          <li
            key={chapter.chapterId}
            value={chapter.ordinal}
            aria-current={chapter.chapterId === selectedChapterId ? 'true' : undefined}
          >
            <button disabled={busy} onClick={() => onSelect(chapter)}>
              {chapter.title}
            </button>
            {savedChapterIds.includes(chapter.chapterId) && <span> 번역 저장됨</span>}
            {chapter.chapterId === selectedChapterId && <span> 선택한 회차</span>}
          </li>
        ))}
      </ol>
      {work.nextPageUrl && (
        <button disabled={busy} onClick={onLoadMore}>
          다음 목차 페이지 불러오기
        </button>
      )}
    </section>
  );
}
