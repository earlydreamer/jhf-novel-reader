import { useEffect, useRef, useState, type JSX } from 'react';
import type { ChapterRef, WorkPage } from '../contracts/reading';
import { BatchPanel } from './BatchPanel';
import type { BatchPanelProps } from './BatchPanel';
import { GuidancePanel, type GuidancePanelProps } from './GuidancePanel';
import { TitleHeading, type TitleControls } from './TitleHeading';
import { displayedTitle } from '../translation/titles';
import { BottomSheet, Dialog } from './components/Modal';
import { Button } from './components/Button';
import { ListItem } from './components/ListItem';
import type { WorkRecentSnapshot } from '../app/renewalController';

export interface WorkScreenProps extends Omit<BatchPanelProps, 'workId'> {
  work: WorkPage;
  selectedChapterId?: string;
  recentChapterId?: string;
  recentStatus?: WorkRecentSnapshot['status'] | 'idle';
  batchGlobalBlocked?: boolean;
  dialogRequest?: { dialog: 'guidance' | 'batch'; id: number; workId: string } | null;
  onDialogRequestHandled?(id: number): void;
  busy: boolean;
  savedChapterIds: readonly string[];
  onSelect(chapter: ChapterRef): void;
  onLoadMore(): void;
  onContinue?(): void;
  onRetryContinue?(): void;
  guidance?: Omit<GuidancePanelProps, 'workId'>;
  titles?: TitleControls;
}
export function WorkScreen({
  work,
  selectedChapterId,
  recentChapterId,
  savedChapterIds,
  busy,
  onSelect,
  onLoadMore,
  recentStatus,
  dialogRequest,
  onDialogRequestHandled,
  onContinue,
  onRetryContinue,
  batch,
  batchAvailable,
  batchGlobalBlocked,
  onPrepareBatch,
  onRunBatch,
  onScanBatch,
  onConfirmBatchCandidates,
  onCancelBatch,
  onRetryBatchSave,
  onSettings,
  guidance,
  titles,
}: WorkScreenProps): JSX.Element {
  const [sheetChapter, setSheetChapter] = useState<ChapterRef | null>(null);
  const [dialog, setDialog] = useState<'guidance' | 'batch' | null>(null);
  const guidanceBody = useRef<HTMLDivElement>(null);
  const recentRow = useRef<HTMLDivElement>(null);
  const didScrollRecent = useRef(false);
  const recentIsLoaded =
    !!recentChapterId && work.chapters.some((item) => item.chapterId === recentChapterId);
  useEffect(() => {
    if (!recentIsLoaded || !recentChapterId || didScrollRecent.current) return;
    didScrollRecent.current = true;
    recentRow.current?.scrollIntoView?.({ block: 'nearest' });
  }, [recentChapterId, recentIsLoaded]);
  useEffect(() => {
    if (!dialogRequest) return;
    return () => onDialogRequestHandled?.(dialogRequest.id);
  }, [dialogRequest, onDialogRequestHandled]);
  const requestedDialog = dialogRequest?.workId === work.workId ? dialogRequest.dialog : null;
  const visibleDialog = requestedDialog ?? dialog;
  const closeDialog = () => {
    setDialog(null);
    if (requestedDialog && dialogRequest) onDialogRequestHandled?.(dialogRequest.id);
  };
  const savedCount = new Set(savedChapterIds).size;
  const uniqueChapterCount = new Set(work.chapters.map((chapter) => chapter.chapterId)).size;
  const maximumOrdinal = Math.max(0, ...work.chapters.map((chapter) => chapter.ordinal));
  const recordWorkId = batch?.record?.work.workId;
  const batchOwner = batch?.preparing
    ? batch.preparingWorkId
    : batch?.active
      ? recordWorkId
      : (batch?.errorWorkId ?? recordWorkId);
  const recentOwnsWork = batchOwner === work.workId;
  const currentBatchActive = Boolean(recentOwnsWork && batch?.active);
  const batchRecord = recordWorkId === work.workId ? (batch?.record ?? null) : null;
  const visibleBatch = !batch
    ? null
    : batch.preparing
      ? batch.preparingWorkId !== work.workId
        ? null
        : recordWorkId === work.workId
          ? batch
          : {
              ...batch,
              record: null,
              error: null,
              scanProgress: undefined,
              chapterProgress: undefined,
            }
      : batchRecord
        ? {
            ...batch,
            error: batch.errorWorkId && batch.errorWorkId !== work.workId ? null : batch.error,
          }
        : batch.errorWorkId === work.workId
          ? {
              ...batch,
              record: null,
              scanProgress: undefined,
              chapterProgress: undefined,
            }
          : null;
  const selectedTitles = titles?.entries ?? [];
  const chapterSavedTitle = (chapter: ChapterRef) =>
    selectedTitles.find(
      (entry) => entry.key === chapter.chapterId && entry.source === chapter.title,
    );
  const openSheet = (chapter: ChapterRef) => setSheetChapter(chapter);
  const sheetTitle = sheetChapter ? chapterSavedTitle(sheetChapter) : undefined;
  const currentRecentStatus = recentStatus ?? 'none';
  return (
    <section className="nr-work-screen" aria-label="작품 목차">
      <header className="nr-work-heading">
        <TitleHeading
          key={`title:${work.workId}`}
          titleKey={work.workId}
          source={work.title}
          label="작품 제목"
          controls={titles}
        />
        <p lang="ja" className="nr-work-heading__original">
          {work.title}
        </p>
        <p className="nr-work-heading__meta">
          {work.complete
            ? `전체 ${uniqueChapterCount}화 · ${savedCount}화 저장됨`
            : `${maximumOrdinal}화까지 확인했어요 · ${savedCount}화 저장됨`}
        </p>
        <Button
          variant="filled"
          className="nr-work-continue"
          disabled={
            busy ||
            currentRecentStatus === 'loading' ||
            currentRecentStatus === 'idle' ||
            currentRecentStatus === 'error'
          }
          onClick={() => onContinue?.()}
        >
          이어서 읽기
        </Button>
        {(currentRecentStatus === 'loading' || currentRecentStatus === 'idle') && (
          <p role="status">최근 읽은 위치를 확인하고 있어요.</p>
        )}
        {currentRecentStatus === 'error' && (
          <p role="alert">
            최근 읽은 회차를 확인하지 못했어요. 다시 시도해 주세요.{' '}
            <button type="button" onClick={() => onRetryContinue?.()}>
              다시 시도
            </button>
          </p>
        )}
      </header>
      {currentBatchActive && (
        <div className="nr-batch-progress-card">
          <button type="button" onClick={() => setDialog('batch')}>
            <span>
              {batch?.preparing
                ? '미리 번역 대상을 확인하고 있어요'
                : `미리 번역하는 중 · ${batchRecord?.cursor ?? 0}/${batchRecord?.chapters.length ?? 0}화`}
            </span>
            <span>진행 보기</span>
          </button>
          <Button variant="text" onClick={onCancelBatch}>
            중단
          </Button>
        </div>
      )}
      <h2>회차 목록</h2>
      <ol className="nr-work-chapters" start={work.chapters[0]?.ordinal || 1}>
        {work.chapters.map((chapter) => {
          const saved = savedChapterIds.includes(chapter.chapterId);
          const actualRecent = recentIsLoaded && chapter.chapterId === recentChapterId;
          const translated = chapterSavedTitle(chapter);
          const chapterTitle = displayedTitle(selectedTitles, chapter.chapterId, chapter.title);
          const supporting = [
            saved ? '저장됨' : '',
            actualRecent ? '읽는 중' : '',
            translated ? '' : '제목 번역 전',
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <li key={chapter.chapterId} value={chapter.ordinal}>
              <div ref={actualRecent ? recentRow : undefined}>
                <ListItem
                  headline={
                    <>
                      <span>{chapter.ordinal}화</span>　{chapterTitle}
                    </>
                  }
                  supporting={supporting || undefined}
                  lang={translated ? undefined : 'ja'}
                  current={actualRecent}
                  disabled={busy}
                  mainLabel={`${chapter.ordinal}화 ${chapterTitle}`}
                  supportingId={
                    supporting
                      ? `chapter-${encodeURIComponent(chapter.chapterId)}-state`
                      : undefined
                  }
                  onContextMenu={(event) => {
                    event.preventDefault();
                    openSheet(chapter);
                  }}
                  onClick={() => onSelect(chapter)}
                  trailing={
                    <button
                      type="button"
                      aria-label={`${chapter.ordinal}화 메뉴`}
                      onClick={() => openSheet(chapter)}
                    >
                      ⋮
                    </button>
                  }
                />
              </div>
              {selectedChapterId === chapter.chapterId && !actualRecent && (
                <span className="nr-work-selected-hint">선택한 회차</span>
              )}
            </li>
          );
        })}
      </ol>
      {work.nextPageUrl && (
        <Button variant="text" disabled={busy} onClick={onLoadMore}>
          다음 목차 페이지 불러오기
        </Button>
      )}
      <BottomSheet
        open={!!sheetChapter}
        title={sheetChapter ? `${sheetChapter.ordinal}화 메뉴` : '회차 메뉴'}
        onClose={() => setSheetChapter(null)}
      >
        {sheetChapter && (
          <div className="nr-work-chapter-menu">
            <p>{sheetTitle ? '제목 다시 번역하기' : '제목 번역하기'}</p>
            {titles && (
              <TitleHeading
                titleKey={sheetChapter.chapterId}
                source={sheetChapter.title}
                label={`${sheetChapter.ordinal}화 제목`}
                controls={titles}
                inline
              />
            )}
            <a href={sheetChapter.canonicalUrl} target="_blank" rel="noreferrer">
              원문 사이트에서 보기
            </a>
          </div>
        )}
      </BottomSheet>
      <Dialog
        open={visibleDialog === 'guidance'}
        title="작품 용어집"
        onClose={closeDialog}
        keepMounted
        fullScreen={{
          confirmLabel: '저장하기',
          onConfirm: () =>
            guidanceBody.current?.querySelector<HTMLButtonElement>('[data-guidance-save]')?.click(),
          confirmDisabled: guidance?.locked,
        }}
      >
        {guidance && (
          <div ref={guidanceBody}>
            <GuidancePanel
              key={work.workId}
              workId={work.workId}
              {...guidance}
              refreshKey={
                batchRecord?.scan?.status === 'confirmed' ? batchRecord.guidance?.hash : undefined
              }
            />
          </div>
        )}
      </Dialog>
      <Dialog
        open={visibleDialog === 'batch'}
        title="미리 번역하기"
        onClose={closeDialog}
        fullScreen
        keepMounted
      >
        <BatchPanel
          key={`${work.workId}:${batchRecord?.id ?? 'none'}`}
          workId={work.workId}
          batch={visibleBatch}
          batchAvailable={batchAvailable}
          globalBlocked={batchGlobalBlocked}
          onPrepareBatch={onPrepareBatch}
          onRunBatch={onRunBatch}
          onScanBatch={onScanBatch}
          onConfirmBatchCandidates={onConfirmBatchCandidates}
          onCancelBatch={recentOwnsWork ? onCancelBatch : undefined}
          onRetryBatchSave={recentOwnsWork ? onRetryBatchSave : undefined}
          onSettings={onSettings}
        />
      </Dialog>
      {recentChapterId && !recentIsLoaded && (
        <span className="sr-only">최근 읽은 회차는 현재 목차 범위에 없어요.</span>
      )}
    </section>
  );
}
