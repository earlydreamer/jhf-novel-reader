import { useEffect, useRef, useState, type JSX } from 'react';
import type { ChapterRef, ChapterRemovalResult, WorkPage } from '../contracts/reading';
import { BatchPanel } from './BatchPanel';
import type { BatchPanelProps } from './BatchPanel';
import { GuidancePanel, type GuidancePanelProps } from './GuidancePanel';
import { TermScanPanel, type TermScanPanelProps } from './TermScanPanel';
import { TitleHeading, type TitleControls } from './TitleHeading';
import { displayedTitle } from '../translation/titles';
import { BottomSheet, Dialog } from './components/Modal';
import { Button } from './components/Button';
import { ListItem } from './components/ListItem';
import { useSnackbar } from './components/Snackbar';
import type { RenewalSnapshot, WorkRecentSnapshot } from '../app/renewalController';

const CHAPTER_REMOVAL_UNKNOWN_MESSAGE =
  '삭제 여부를 확인하지 못했어요. 앱을 다시 열어 확인해 주세요.';
function chapterRemovalMessage(ordinal: number, result: ChapterRemovalResult): string {
  if (result.removed === true)
    return result.cleanupComplete
      ? `${ordinal}화 저장본을 삭제했어요.`
      : `${ordinal}화 저장본을 삭제했어요. 일부 파일은 다음에 정리할게요.`;
  if (result.removed === null) return CHAPTER_REMOVAL_UNKNOWN_MESSAGE;
  if (result.blockedBy === 'translation')
    return '이 화를 번역하고 있어요. 번역을 중단한 뒤 다시 삭제해 주세요.';
  if (result.blockedBy === 'batch')
    return '이 작품을 미리 번역하고 있어요. 미리 번역을 중단한 뒤 다시 삭제해 주세요.';
  return '저장본을 삭제하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
}

export interface WorkScreenProps extends Omit<BatchPanelProps, 'workId'> {
  work: WorkPage;
  selectedChapterId?: string;
  recentChapterId?: string;
  recentStatus?: WorkRecentSnapshot['status'] | 'idle';
  batchGlobalBlocked?: boolean;
  dialogRequest?: { dialog: 'guidance' | 'batch' | 'termScan'; id: number; workId: string } | null;
  onDialogRequestHandled?(id: number): void;
  termScan?: RenewalSnapshot['termScan'];
  onStartTermScan?(workId: string): void;
  onCancelTermScan?(): void;
  onRevertTermScan?(source: string): void;
  onApplyTermScanSuggestion?(source: string): void;
  onCloseTermScan?(): void;
  sources?: TermScanPanelProps['sources'];
  busy: boolean;
  savedChapterIds: readonly string[];
  onSelect(chapter: ChapterRef): void;
  onLoadMore(): void;
  onContinue?(): void;
  onRetryContinue?(): void;
  guidance?: Omit<GuidancePanelProps, 'workId'>;
  titles?: TitleControls;
  onRemoveChapter?(chapter: ChapterRef): Promise<ChapterRemovalResult>;
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
  batchFill,
  fillAllowed,
  onFillBatch,
  onCancelBatchFill,
  onCancelBatch,
  onRetryBatchSave,
  onSettings,
  guidance,
  titles,
  onRemoveChapter,
  termScan,
  onStartTermScan,
  onCancelTermScan,
  onRevertTermScan,
  onApplyTermScanSuggestion,
  onCloseTermScan,
  sources,
}: WorkScreenProps): JSX.Element {
  const [sheetChapter, setSheetChapter] = useState<ChapterRef | null>(null);
  const [dialog, setDialog] = useState<'guidance' | 'batch' | null>(null);
  const [removeChapter, setRemoveChapter] = useState<ChapterRef | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [titleEditChapter, setTitleEditChapter] = useState<ChapterRef | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [titleSaving, setTitleSaving] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const showSnackbar = useSnackbar();
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
  const closeTermScanDialog = () => {
    closeDialog();
    // 스캔이 도는 동안 닫으면 스캔은 이어진다. 끝난 결과만 닫는다.
    if (termScan?.phase === 'running')
      showSnackbar('정밀스캔은 계속 진행돼요. 메뉴의 ‘용어 정밀스캔’에서 다시 볼 수 있어요.');
    else onCloseTermScan?.();
  };
  // 정밀스캔 결과가 새로 나오거나(완료·재스캔 완료) 되돌리기·제안 적용으로 바뀔 때마다 1씩 올린다.
  const termScanResult = termScan?.result;
  const termScanHandled = termScan?.handled.length;
  const [termScanTrack, setTermScanTrack] = useState({
    result: termScanResult,
    handled: termScanHandled,
    revision: 0,
  });
  let termScanRevision = termScanTrack.revision;
  if (termScanTrack.result !== termScanResult || termScanTrack.handled !== termScanHandled) {
    termScanRevision += 1;
    setTermScanTrack({
      result: termScanResult,
      handled: termScanHandled,
      revision: termScanRevision,
    });
  }
  // 정밀스캔이 용어집을 바꾸면 열어 둔 용어집 화면도 다시 읽는다.
  const termScanRefreshKey =
    termScan?.workId === work.workId && termScan.phase === 'done'
      ? `term-scan:${termScanRevision}`
      : undefined;
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
  const openTitleEditor = (chapter: ChapterRef) => {
    setTitleDraft(displayedTitle(selectedTitles, chapter.chapterId, chapter.title));
    setTitleError(null);
    setTitleEditChapter(chapter);
  };
  const saveChapterTitle = async () => {
    if (!titleEditChapter || !titles || titleSaving || !titleDraft.trim()) return;
    setTitleSaving(true);
    setTitleError(null);
    try {
      await titles.onSave(titleEditChapter.chapterId, titleDraft.trim());
      setTitleEditChapter(null);
    } catch {
      setTitleError('제목을 저장하지 못했어요. 입력한 내용은 그대로 남아 있어요.');
    } finally {
      setTitleSaving(false);
    }
  };
  const currentRecentStatus = recentStatus ?? 'none';
  const confirmRemoveChapter = async () => {
    if (!removeChapter || removeBusy || !onRemoveChapter) return;
    const target = removeChapter;
    setRemoveBusy(true);
    let message: string;
    try {
      message = chapterRemovalMessage(target.ordinal, await onRemoveChapter(target));
    } catch {
      message = CHAPTER_REMOVAL_UNKNOWN_MESSAGE;
    }
    setRemoveBusy(false);
    setRemoveChapter(null);
    showSnackbar(message);
  };
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
            {titles && (
              <button
                type="button"
                className="nr-sheet-action"
                disabled={titles.busy}
                onClick={() => {
                  void titles.onTranslate(sheetChapter.chapterId);
                  setSheetChapter(null);
                }}
              >
                {sheetTitle ? '제목 다시 번역하기' : '제목 번역하기'}
              </button>
            )}
            {titles && (
              <button
                type="button"
                className="nr-sheet-action"
                onClick={() => {
                  setSheetChapter(null);
                  openTitleEditor(sheetChapter);
                }}
              >
                제목 직접 수정하기
                {sheetTitle?.origin === 'user' && (
                  <span className="nr-sheet-action__supporting">직접 수정됨</span>
                )}
              </button>
            )}
            <a
              className="nr-sheet-action"
              href={sheetChapter.canonicalUrl}
              target="_blank"
              rel="noreferrer"
            >
              원문 사이트에서 보기
            </a>
            {onRemoveChapter && savedChapterIds.includes(sheetChapter.chapterId) && (
              <button
                type="button"
                className="nr-sheet-action nr-sheet-action--danger"
                disabled={busy}
                onClick={() => {
                  setRemoveChapter(sheetChapter);
                  setSheetChapter(null);
                }}
              >
                이 화 저장본 삭제하기
              </button>
            )}
          </div>
        )}
      </BottomSheet>
      <Dialog
        open={!!removeChapter}
        title={
          removeChapter ? `${removeChapter.ordinal}화 저장본을 삭제할까요?` : '저장본을 삭제할까요?'
        }
        onClose={() => {
          if (!removeBusy) setRemoveChapter(null);
        }}
        actions={
          <>
            <Button variant="text" disabled={removeBusy} onClick={() => setRemoveChapter(null)}>
              닫기
            </Button>
            <Button
              variant="filled"
              tone="danger"
              disabled={removeBusy}
              onClick={() => void confirmRemoveChapter()}
            >
              삭제하기
            </Button>
          </>
        }
      >
        <p>
          이 화의 번역 저장본과 읽던 위치가 이 기기에서 삭제돼요. 삭제한 내용은 되돌릴 수 없어요.
        </p>
      </Dialog>
      <Dialog
        open={!!titleEditChapter}
        title="회차 제목 직접 수정하기"
        onClose={() => {
          if (!titleSaving) setTitleEditChapter(null);
        }}
        actions={
          <>
            <Button variant="text" disabled={titleSaving} onClick={() => setTitleEditChapter(null)}>
              닫기
            </Button>
            <Button
              variant="filled"
              disabled={titleSaving || !titleDraft.trim()}
              onClick={() => void saveChapterTitle()}
            >
              저장하기
            </Button>
          </>
        }
      >
        {titleEditChapter && (
          <>
            <p lang="ja">원제: {titleEditChapter.title}</p>
            <label>
              {titleEditChapter.ordinal}화 제목 번역문
              <input
                value={titleDraft}
                maxLength={4096}
                onChange={(event) => setTitleDraft(event.target.value)}
              />
            </label>
            {titleError && <p role="alert">{titleError}</p>}
          </>
        )}
      </Dialog>
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
                [
                  batchRecord?.scan?.status === 'confirmed'
                    ? batchRecord.guidance?.hash
                    : undefined,
                  termScanRefreshKey,
                ]
                  .filter(Boolean)
                  .join('|') || undefined
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
          batchFill={batchFill}
          fillAllowed={fillAllowed}
          onFillBatch={onFillBatch}
          onCancelBatchFill={onCancelBatchFill}
          onCancelBatch={recentOwnsWork ? onCancelBatch : undefined}
          onRetryBatchSave={recentOwnsWork ? onRetryBatchSave : undefined}
          onSettings={onSettings}
        />
      </Dialog>
      <Dialog
        open={visibleDialog === 'termScan'}
        title="용어 정밀스캔"
        onClose={closeTermScanDialog}
        fullScreen
        keepMounted
      >
        <TermScanPanel
          workId={work.workId}
          savedCount={savedCount}
          state={termScan ?? null}
          onStart={() => onStartTermScan?.(work.workId)}
          onCancel={() => onCancelTermScan?.()}
          onRevert={(source) => onRevertTermScan?.(source)}
          onApplySuggestion={(source) => onApplyTermScanSuggestion?.(source)}
          sources={sources ?? { wikipedia: false, namuwiki: false }}
        />
      </Dialog>
      {recentChapterId && !recentIsLoaded && (
        <span className="sr-only">최근 읽은 회차는 현재 목차 범위에 없어요.</span>
      )}
    </section>
  );
}
