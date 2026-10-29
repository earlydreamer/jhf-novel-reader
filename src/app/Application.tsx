import type { JSX } from 'react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { HomeScreen } from '../ui/HomeScreen';
import { WorkScreen } from '../ui/WorkScreen';
import { ImmersiveReader } from '../ui/ImmersiveReader';
import { SettingsScreen } from '../ui/SettingsScreen';
import { useReaderGlossary } from '../ui/readerGlossary';
import { TopAppBar } from '../ui/components/TopAppBar';
import { IconButton } from '../ui/components/IconButton';
import { Menu } from '../ui/components/Menu';
import type { MenuItem } from '../ui/components/Menu';
import { Button } from '../ui/components/Button';
import { Dialog } from '../ui/components/Modal';
import { SnackbarProvider, useSnackbar } from '../ui/components/Snackbar';
import { runTopBackHandler } from '../ui/shell/backStack';
import { useResolvedTheme } from '../ui/theme/theme';
import { capacitorBackup, type BackupPlatform } from '../platform/backup';
import { capacitorShell, type ShellPlatform } from '../platform/shell';
import type { WorkRemovalResult } from '../contracts/reading';
import type { RenewalController, RenewalSnapshot } from './renewalController';
import '../ui/theme/base.css';
import './application.css';

type ChapterUpdateRequest = { kind: 'all' } | { kind: 'work'; workId: string };

function RouteScreen({
  controller,
  state,
  backup,
  urlDialogOpen,
  onCloseUrlDialog,
  onRequestRemove,
  onRequestChapterUpdates,
  workDialogRequest,
  onWorkDialogRequestHandled,
}: {
  controller: RenewalController;
  state: RenewalSnapshot;
  backup: BackupPlatform;
  urlDialogOpen: boolean;
  onCloseUrlDialog(): void;
  onRequestRemove(workId: string, title: string): void;
  onRequestChapterUpdates(workId?: string): void;
  workDialogRequest: {
    dialog: 'guidance' | 'batch' | 'termScan';
    id: number;
    workId: string;
  } | null;
  onWorkDialogRequestHandled(id: number): void;
}): JSX.Element {
  // 훅은 조건문 밖에서 부른다. 리더 화면일 때만 작품 용어집을 읽는다.
  const readerWorkId =
    state.route.kind === 'translation'
      ? (state.chapter?.workId ?? null)
      : state.route.kind === 'reader'
        ? (state.version?.source.workId ?? null)
        : null;
  const [guidanceRevision, setGuidanceRevision] = useState(0);
  const guidanceLocked =
    state.busy ||
    state.translationActive ||
    state.termScan?.phase === 'running' ||
    state.batchFill?.phase === 'running';
  const readerGuidance = state.guidanceAvailable
    ? {
        locked: guidanceLocked,
        onRead: controller.readGuidance,
        onSave: controller.saveGuidance,
        onSaved: () => setGuidanceRevision((value) => value + 1),
      }
    : undefined;
  const glossary = useReaderGlossary({
    workId: state.guidanceAvailable ? readerWorkId : null,
    refreshKey: `${state.version?.versionId ?? ''}:${guidanceRevision}`,
    read: controller.readGuidance,
    save: controller.saveGuidance,
  });
  const readerGlossary = glossary ? { ...glossary, locked: guidanceLocked } : undefined;
  const titles = state.titlesAvailable
    ? {
        entries: state.titles,
        busy: state.busy || state.titlesBusy || state.translationActive,
        onTranslate: controller.translateTitles,
        onSave: controller.saveTitle,
      }
    : undefined;
  switch (state.route.kind) {
    case 'home':
      return (
        <HomeScreen
          state={state}
          urlDialogOpen={urlDialogOpen}
          onCloseUrlDialog={onCloseUrlDialog}
          onBrowse={(startUrl) => void controller.browse(startUrl)}
          onOpen={(url) => void controller.openWork(url)}
          onOpenLibraryWork={(workId) => void controller.openLibraryWork(workId)}
          onCheckUpdates={onRequestChapterUpdates}
          onRequestRemove={onRequestRemove}
          onContinue={(id) => void controller.continueReading(id)}
          onOpenPendingSave={controller.openPendingSave}
          onOpenBatch={controller.openBatch}
          onDismissBatchNotice={controller.dismissBatchNotice}
          legacyWarnings={state.legacyWarnings}
        />
      );
    case 'work':
      return state.work ? (
        <WorkScreen
          key={state.work.workId}
          titles={titles}
          work={state.workViewport ?? state.work}
          totalChapterCount={state.work.complete ? state.work.chapters.length : null}
          previousPageUrl={state.previousWorkPageUrl}
          onLoadPrevious={() => void controller.loadPreviousWorkPage()}
          updateStatus={state.chapterUpdates.works[state.work.workId]}
          recentStatus={
            state.workRecent?.workId === state.work.workId ? state.workRecent.status : 'loading'
          }
          recentChapterId={
            state.workRecent?.workId === state.work.workId && state.workRecent.status === 'verified'
              ? state.workRecent.chapterId
              : undefined
          }
          dialogRequest={workDialogRequest}
          onDialogRequestHandled={onWorkDialogRequestHandled}
          savedChapterIds={state.savedChapterIds}
          selectedChapterId={state.route.selectedChapterId}
          busy={state.busy}
          onContinue={() => void controller.continueReadingFromWork(state.work!.workId)}
          onRetryContinue={() => void controller.retryWorkRecent(state.work!.workId)}
          onSelect={(chapter) => void controller.selectChapter(chapter)}
          guidance={
            state.guidanceAvailable
              ? {
                  locked: guidanceLocked,
                  onRead: controller.readGuidance,
                  onSave: controller.saveGuidance,
                }
              : undefined
          }
          onLoadMore={() => void controller.loadMoreWorkPage()}
          onRemoveChapter={(chapter) => controller.removeChapterVersions(chapter)}
          batch={state.batch}
          batchGlobalBlocked={
            !!state.batch?.active ||
            state.batch?.record?.phase === 'saving' ||
            !!state.pendingSaveChapter
          }
          batchAvailable={
            state.batchAvailable &&
            (state.catalogStatus === 'connected' || state.catalogStatus === 'idle') &&
            !!state.selectedModelId &&
            !state.translationActive
          }
          onPrepareBatch={(range, retranslate) => void controller.prepareBatch(range, retranslate)}
          onRunBatch={(retryUncertain) => void controller.runBatch(retryUncertain)}
          onScanBatch={() => void controller.scanBatch()}
          onConfirmBatchCandidates={(choices) => void controller.confirmBatchCandidates(choices)}
          batchFill={state.batchFill}
          fillAllowed={
            state.batchFillAvailable && state.connection.provider === 'openai-compatible'
          }
          onFillBatch={() => void controller.fillBatchCandidates()}
          onCancelBatchFill={controller.cancelBatchFill}
          onCancelBatch={controller.cancelBatch}
          onRetryBatchSave={() => void controller.retryBatchSave()}
          onSettings={() => controller.navigate({ kind: 'settings' })}
          termScan={state.termScan}
          onStartTermScan={(workId) => void controller.startTermScan(workId)}
          onCancelTermScan={controller.cancelTermScan}
          onRevertTermScan={(source) => void controller.revertTermScanChange(source)}
          onApplyTermScanSuggestion={(source) => void controller.applyTermScanSuggestion(source)}
          onRemoveTermScanCommon={(source) => void controller.removeTermScanCommon(source)}
          onCloseTermScan={controller.closeTermScan}
          sources={{ wikipedia: state.lookupWikipedia, namuwiki: state.lookupNamuwiki }}
        />
      ) : (
        <p>작품 목차를 찾지 못했어요.</p>
      );
    case 'translation':
      return state.chapter ? (
        <ImmersiveReader
          key={`${state.chapter.workId}:${state.chapter.chapterId}`}
          route="translation"
          chapter={state.chapter}
          work={state.work}
          version={state.version}
          position={state.position}
          translation={state.translation}
          translationActive={state.translationActive}
          paragraphRepair={state.paragraphRepair}
          translationAvailable={state.translationAvailable}
          selectedModelId={state.selectedModelId}
          connected={state.catalogStatus === 'connected' && !!state.selectedModelId}
          catalogStatus={state.catalogStatus}
          connectionConfigured={!!state.connection.baseUrl}
          fontSize={state.fontSize}
          readingBackground={state.readingBackground}
          lineHeight={state.lineHeight}
          termHighlight={state.termHighlight}
          glossary={readerGlossary}
          guidance={readerGuidance}
          showOriginal={state.showOriginal}
          sourceChange={state.sourceChange}
          busy={state.busy}
          retryParagraphsAvailable={
            state.streamingAvailable && state.connection.provider === 'openai-compatible'
          }
          pendingSaveElsewhere={
            !!state.pendingSaveChapter &&
            state.pendingSaveChapter.chapterId !== state.chapter.chapterId
          }
          titles={
            state.titlesAvailable
              ? { entries: state.titles, busy: titles?.busy ?? false }
              : undefined
          }
          onBack={controller.showContents}
          onShowOriginal={controller.showOriginal}
          onFontSize={controller.changeFontSize}
          onReadingBackground={controller.changeReadingBackground}
          onLineHeight={controller.changeLineHeight}
          onTermHighlight={controller.changeTermHighlight}
          onPreviewPosition={controller.previewPosition}
          onPosition={(block, offset) => void controller.savePosition(block, offset)}
          onAdjacent={controller.adjacentChapter}
          onTranslate={() => void controller.translate()}
          onCancel={controller.cancelTranslation}
          onRetry={() => void controller.retryTranslation()}
          onRetrySave={() => void controller.retrySave()}
          onRetryParagraphs={
            state.streamingAvailable && state.connection.provider === 'openai-compatible'
              ? (indexes) => void controller.retryParagraphs(indexes)
              : undefined
          }
          onSettings={() => controller.navigate({ kind: 'settings' })}
          onCheckConnection={() => void controller.checkConnection()}
          onRefreshSource={() => void controller.refreshSource()}
          onRetranslate={() => void controller.retranslateChapter()}
          onOpenSaved={() => void controller.openSavedTranslation()}
          onRetryTitle={
            state.titlesAvailable
              ? () => void controller.translateTitles(state.chapter!.chapterId)
              : undefined
          }
          onSaveTitle={
            state.titlesAvailable
              ? (value) => controller.saveTitle(state.chapter!.chapterId, value)
              : undefined
          }
          onGoHome={controller.goHome}
          onDisplayed={controller.readerDisplayed}
        />
      ) : (
        <p>선택한 회차를 찾지 못했어요.</p>
      );
    case 'reader':
      return state.version ? (
        <ImmersiveReader
          key={`${state.version.source.workId}:${state.version.source.chapterId}`}
          route="reader"
          chapter={
            state.chapter ?? {
              workId: state.version.source.workId,
              chapterId: state.version.source.chapterId,
              canonicalUrl: state.version.source.canonicalUrl,
              title: state.version.source.title,
              ordinal:
                state.work?.chapters.find(
                  (chapter) => chapter.chapterId === state.version!.source.chapterId,
                )?.ordinal ?? 1,
            }
          }
          work={state.work}
          version={state.version}
          position={state.position}
          translation={state.translation}
          translationActive={state.translationActive}
          paragraphRepair={state.paragraphRepair}
          translationAvailable={state.translationAvailable}
          selectedModelId={state.selectedModelId}
          connected={state.catalogStatus === 'connected' && !!state.selectedModelId}
          catalogStatus={state.catalogStatus}
          connectionConfigured={!!state.connection.baseUrl}
          fontSize={state.fontSize}
          readingBackground={state.readingBackground}
          lineHeight={state.lineHeight}
          termHighlight={state.termHighlight}
          glossary={readerGlossary}
          guidance={readerGuidance}
          showOriginal={state.showOriginal}
          sourceChange={state.sourceChange}
          busy={state.busy}
          retryParagraphsAvailable={
            state.streamingAvailable && state.connection.provider === 'openai-compatible'
          }
          titles={
            state.titlesAvailable
              ? { entries: state.titles, busy: titles?.busy ?? false }
              : undefined
          }
          onBack={controller.showContents}
          onShowOriginal={controller.showOriginal}
          onFontSize={controller.changeFontSize}
          onReadingBackground={controller.changeReadingBackground}
          onLineHeight={controller.changeLineHeight}
          onTermHighlight={controller.changeTermHighlight}
          onPreviewPosition={controller.previewPosition}
          onPosition={(block, offset) => void controller.savePosition(block, offset)}
          onAdjacent={controller.adjacentChapter}
          onTranslate={() => void controller.translate()}
          onCancel={controller.cancelTranslation}
          onRetry={() => void controller.retryTranslation()}
          onRetrySave={() => void controller.retrySave()}
          onRetryParagraphs={
            state.streamingAvailable && state.connection.provider === 'openai-compatible'
              ? (indexes) => void controller.retryParagraphs(indexes)
              : undefined
          }
          onSettings={() => controller.navigate({ kind: 'settings' })}
          onCheckConnection={() => void controller.checkConnection()}
          onRefreshSource={() => void controller.refreshSource()}
          onRetranslate={() => void controller.retranslateChapter()}
          onOpenSaved={() => void controller.openSavedTranslation()}
          onRetryTitle={
            state.titlesAvailable
              ? () => void controller.translateTitles(state.version!.source.chapterId)
              : undefined
          }
          onSaveTitle={
            state.titlesAvailable
              ? (value) => controller.saveTitle(state.version!.source.chapterId, value)
              : undefined
          }
          onGoHome={controller.goHome}
          onDisplayed={controller.readerDisplayed}
        />
      ) : (
        <p>저장된 번역을 찾지 못했어요.</p>
      );
    case 'settings':
      return (
        <SettingsScreen
          state={state}
          onChange={controller.changeConnection}
          onCheck={controller.checkConnection}
          onSelect={controller.chooseModel}
          onMode={controller.changeTranslationMode}
          onAutoTranslate={controller.changeAutoTranslate}
          onAutoRetryFailed={controller.changeAutoRetryFailed}
          onAutoGlossary={controller.changeAutoGlossary}
          onChapterUpdateDays={controller.changeChapterUpdateDays}
          onLookupWikipedia={controller.changeLookupWikipedia}
          onLookupNamuwiki={controller.changeLookupNamuwiki}
          onEnableEmbedding={controller.enableOnDeviceEmbedding}
          onDisableEmbedding={controller.disableOnDeviceEmbedding}
          onCancelEmbeddingDownload={controller.cancelEmbeddingDownload}
          onRemoveEmbeddingModel={controller.removeEmbeddingModel}
          onTheme={controller.changeTheme}
          backup={{
            available: backup.available(),
            // 쓰는 중인 데이터를 묶거나 바꾸지 않도록 쓰기가 진행 중이면 막는다.
            locked:
              state.busy ||
              state.translationActive ||
              !!state.pendingSaveChapter ||
              !!state.batch?.active ||
              state.batchFill?.phase === 'running' ||
              state.termScan?.phase === 'running',
            onExport: backup.exportBackup,
            onRestore: backup.restoreBackup,
          }}
        />
      );
  }
}

const routeTitles = {
  work: '목차',
  translation: '읽기',
  reader: '읽기',
  settings: '설정',
} as const;

function ShellAppBar({
  controller,
  state,
  onOpenUrlDialog,
  onRequestRemove,
  onRequestChapterUpdates,
  onOpenWorkDialog,
}: {
  controller: RenewalController;
  state: RenewalSnapshot;
  onOpenUrlDialog(): void;
  onRequestRemove(workId: string, title: string): void;
  onRequestChapterUpdates(workId?: string): void;
  onOpenWorkDialog(dialog: 'guidance' | 'batch' | 'termScan'): void;
}): JSX.Element | null {
  if (state.route.kind === 'home')
    return (
      <TopAppBar
        title="서재"
        titleAs="span"
        actions={
          <>
            {state.chapterUpdatesAvailable && state.libraryWorks.length > 0 && (
              <IconButton
                icon="refresh"
                label={
                  state.chapterUpdates.checkingAll
                    ? '서재 새 회차 확인 중…'
                    : '서재 전체 새 회차 확인'
                }
                disabled={state.chapterUpdates.checkingAll}
                aria-busy={state.chapterUpdates.checkingAll}
                onClick={() => onRequestChapterUpdates()}
              />
            )}
            <IconButton icon="link" label="URL로 열기" onClick={onOpenUrlDialog} />
            <IconButton
              icon="settings"
              label="설정"
              onClick={() => controller.navigate({ kind: 'settings' })}
            />
          </>
        }
      />
    );
  const items: MenuItem[] = [{ label: '서재로 가기', onSelect: controller.goHome }];
  if (state.route.kind === 'work' && state.work) {
    if (state.guidanceAvailable)
      items.push({ label: '용어집 편집하기', onSelect: () => onOpenWorkDialog('guidance') });
    if (state.termScanAvailable && state.connection.provider === 'openai-compatible')
      items.push({ label: '용어 정밀스캔', onSelect: () => onOpenWorkDialog('termScan') });
    items.push({ label: '미리 번역하기', onSelect: () => onOpenWorkDialog('batch') });
    if (state.titlesAvailable)
      items.push({
        label: '목차 제목 번역하기',
        onSelect: () => void controller.translateTitles(),
      });
    items.push({
      label: '원문 사이트에서 보기',
      onSelect: () => window.open(state.work!.canonicalUrl, '_blank', 'noopener,noreferrer'),
    });
    items.push({
      label: '현재 목차 원문 보기',
      onSelect: () => window.open(state.work!.pageUrl, '_blank', 'noopener,noreferrer'),
    });
    items.push({
      label: '서재에서 제거하기',
      tone: 'danger',
      icon: 'delete',
      onSelect: () =>
        onRequestRemove(
          state.work!.workId,
          state.recentTitles[state.work!.workId] ?? state.work!.title,
        ),
    });
  }
  if (state.route.kind !== 'settings')
    items.push({ label: '설정', onSelect: () => controller.navigate({ kind: 'settings' }) });
  if (state.route.kind === 'translation' || state.route.kind === 'reader') return null;
  return (
    <TopAppBar
      title={
        state.route.kind === 'work' && state.work
          ? (state.recentTitles[state.work.workId] ?? state.work.title)
          : routeTitles[state.route.kind]
      }
      titleAs="span"
      navigation={<IconButton icon="arrow_back" label="뒤로 가기" onClick={controller.back} />}
      actions={
        <>
          {state.route.kind === 'work' && state.work && state.chapterUpdatesAvailable && (
            <IconButton
              icon="refresh"
              label={
                state.chapterUpdates.works[state.work.workId]?.checking
                  ? '새 회차 확인 중…'
                  : '새 회차 확인'
              }
              disabled={state.chapterUpdates.works[state.work.workId]?.checking}
              aria-busy={state.chapterUpdates.works[state.work.workId]?.checking ?? false}
              onClick={() => onRequestChapterUpdates(state.work!.workId)}
            />
          )}
          <Menu label="더보기" items={items} />
        </>
      }
    />
  );
}

export function Application({
  controller,
  platform = capacitorShell,
  backup = capacitorBackup,
}: {
  controller: RenewalController;
  platform?: ShellPlatform;
  backup?: BackupPlatform;
}): JSX.Element {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [chapterUpdateRequest, setChapterUpdateRequest] = useState<ChapterUpdateRequest | null>(
    null,
  );
  const [workDialogRequest, setWorkDialogRequest] = useState<{
    dialog: 'guidance' | 'batch' | 'termScan';
    id: number;
    workId: string;
  } | null>(null);
  const workDialogSequence = useRef(0);
  const handleWorkDialogRequestHandled = useCallback((id: number) => {
    setWorkDialogRequest((current) => (current?.id === id ? null : current));
  }, []);
  const [removeTarget, setRemoveTarget] = useState<{
    workId: string;
    title: string;
    savedCount: number;
  } | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [actionNotice, setActionNotice] = useState<{ id: number; text: string } | null>(null);
  const actionNoticeSequence = useRef(0);
  const showActionNotice = (text: string) => {
    actionNoticeSequence.current += 1;
    setActionNotice({ id: actionNoticeSequence.current, text });
  };
  const requestChapterUpdates = (workId?: string) => {
    if (!state.chapterUpdatesAvailable) return;
    if (workId) {
      if (state.chapterUpdates.works[workId]?.checking) return;
      const work =
        state.libraryWorks.find((entry) => entry.work.workId === workId)?.work ??
        (state.work?.workId === workId ? state.work : undefined);
      if (work)
        setChapterUpdateRequest({
          kind: 'work',
          workId,
        });
    } else if (!state.chapterUpdates.checkingAll && state.libraryWorks.length > 0) {
      setChapterUpdateRequest({ kind: 'all' });
    }
  };
  const chapterUpdateBusy =
    chapterUpdateRequest?.kind === 'work'
      ? Boolean(state.chapterUpdates.works[chapterUpdateRequest.workId]?.checking)
      : state.chapterUpdates.checkingAll;
  const confirmChapterUpdates = async () => {
    if (!chapterUpdateRequest || chapterUpdateBusy) return;
    const workId = chapterUpdateRequest.kind === 'work' ? chapterUpdateRequest.workId : undefined;
    setChapterUpdateRequest(null);
    try {
      await controller.checkChapterUpdates(workId);
    } catch {
      showActionNotice('새 회차를 확인하지 못했어요. 다시 시도해 주세요.');
    }
  };
  const requestRemove = (workId: string, title: string) => {
    const row = state.libraryWorks.find((entry) => entry.work.workId === workId);
    const savedChapterIds =
      row?.savedChapterIds ?? (state.work?.workId === workId ? state.savedChapterIds : []);
    setRemoveTarget({ workId, title, savedCount: new Set(savedChapterIds).size });
  };
  const confirmRemove = async () => {
    if (!removeTarget || removeBusy) return;
    setRemoveBusy(true);
    let message: string;
    try {
      message = workRemovalMessage(await controller.removeWork(removeTarget.workId));
    } catch {
      message = REMOVAL_UNKNOWN_MESSAGE;
    }
    setRemoveBusy(false);
    setRemoveTarget(null);
    showActionNotice(message);
  };
  useEffect(() => {
    void controller.initialize();
  }, [controller]);
  useEffect(
    () =>
      platform.onBackButton(() => {
        // 순서: 열린 오버레이 → 이전 화면 → 서재에서 앱을 백그라운드로.
        if (runTopBackHandler()) return;
        if (controller.canGoBack()) controller.back();
        else platform.moveToBackground();
      }),
    [controller, platform],
  );
  const theme = useResolvedTheme(state.theme);
  // 리더에서는 독서 배경이 색 체계를 정한다: 세피아는 라이트, 검정은 다크(#173). 리더를 나가면 앱 테마로 돌아간다.
  const inReader = state.route.kind === 'reader' || state.route.kind === 'translation';
  const readingTheme =
    state.readingBackground === 'sepia'
      ? 'light'
      : state.readingBackground === 'black'
        ? 'dark'
        : null;
  const effectiveTheme = inReader && readingTheme ? readingTheme : theme;
  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme;
    platform.setSystemBarsTheme(effectiveTheme);
  }, [effectiveTheme, platform]);
  // 번역·스캔·채우기가 도는 동안에는 화면이 꺼지지 않게 한다.
  const longWorkActive =
    Boolean(state.batch?.active) ||
    state.termScan?.phase === 'running' ||
    state.batchFill?.phase === 'running' ||
    state.translationActive;
  useEffect(() => {
    platform.setKeepAwake(longWorkActive);
  }, [longWorkActive, platform]);
  useEffect(() => () => platform.setKeepAwake(false), [platform]);
  // 첫 화면을 그릴 준비가 되면 스플래시를 내린다. 홈은 서재 목록을 읽은 뒤, 다른 화면은 바로.
  const appReady = state.route.kind !== 'home' || state.libraryLoaded;
  useEffect(() => {
    if (appReady) platform.markReady();
  }, [appReady, platform]);
  const main = useRef<HTMLElement>(null);
  const routeKey = JSON.stringify(state.route);
  const firstRoute = useRef(true);
  useEffect(() => {
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    // 화면이 바뀌면 새 화면 제목으로 포커스를 옮겨 스크린 리더가 위치를 알게 한다.
    const heading = main.current?.querySelector<HTMLElement>('h1');
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }, [routeKey]);
  return (
    <SnackbarProvider offset={state.route.kind === 'home' ? 64 : 0}>
      <SnackbarBridge
        state={state}
        holdErrors={urlDialogOpen && state.route.kind === 'home'}
        notice={actionNotice ?? state.settingsNotice}
      />
      <div className="nr-application" lang="ko">
        <ShellAppBar
          controller={controller}
          state={state}
          onOpenUrlDialog={() => setUrlDialogOpen(true)}
          onRequestRemove={requestRemove}
          onRequestChapterUpdates={requestChapterUpdates}
          onOpenWorkDialog={(dialog) =>
            state.work &&
            setWorkDialogRequest({
              dialog,
              id: ++workDialogSequence.current,
              workId: state.work.workId,
            })
          }
        />
        <main
          ref={main}
          className={`nr-screen${state.route.kind === 'translation' || state.route.kind === 'reader' ? ' nr-screen--immersive' : ''}`}
        >
          <RouteScreen
            controller={controller}
            state={state}
            backup={backup}
            urlDialogOpen={urlDialogOpen}
            onCloseUrlDialog={() => setUrlDialogOpen(false)}
            onRequestRemove={requestRemove}
            onRequestChapterUpdates={requestChapterUpdates}
            workDialogRequest={workDialogRequest}
            onWorkDialogRequestHandled={handleWorkDialogRequestHandled}
          />
        </main>
        <Dialog
          open={chapterUpdateRequest !== null}
          title={
            chapterUpdateRequest?.kind === 'work'
              ? '이 작품의 새 회차를 확인할까요?'
              : '서재 전체 새 회차를 확인할까요?'
          }
          onClose={() => setChapterUpdateRequest(null)}
          actions={
            <>
              <Button variant="text" onClick={() => setChapterUpdateRequest(null)}>
                취소
              </Button>
              <Button
                variant="filled"
                disabled={chapterUpdateBusy}
                onClick={() => void confirmChapterUpdates()}
              >
                확인하기
              </Button>
            </>
          }
        >
          <p>
            {chapterUpdateRequest?.kind === 'work'
              ? '이 작품의 목차를 최신화해요.'
              : '서재에 있는 모든 작품의 목차를 최신화해요.'}
          </p>
        </Dialog>
        <Dialog
          open={!!removeTarget}
          title="서재에서 제거할까요?"
          onClose={() => {
            if (!removeBusy) setRemoveTarget(null);
          }}
          actions={
            <>
              <Button variant="text" disabled={removeBusy} onClick={() => setRemoveTarget(null)}>
                닫기
              </Button>
              <Button
                variant="filled"
                tone="danger"
                disabled={removeBusy}
                onClick={() => void confirmRemove()}
              >
                제거하기
              </Button>
            </>
          }
        >
          {removeTarget && (
            <p>
              ‘{removeTarget.title}’의 저장한 번역 {removeTarget.savedCount}화, 읽던 위치, 번역한
              제목, 용어집이 이 기기에서 함께 삭제돼요. 삭제한 내용은 되돌릴 수 없어요.
            </p>
          )}
        </Dialog>
      </div>
    </SnackbarProvider>
  );
}

const REMOVAL_UNKNOWN_MESSAGE = '제거 여부를 확인하지 못했어요. 앱을 다시 열어 확인해 주세요.';
function workRemovalMessage(result: WorkRemovalResult): string {
  if (result.removed === true)
    return result.cleanupComplete
      ? '작품을 서재에서 제거했어요.'
      : '작품을 서재에서 제거했어요. 일부 파일은 다음에 정리할게요.';
  if (result.removed === null) return REMOVAL_UNKNOWN_MESSAGE;
  if (result.blockedBy === 'translation')
    return '이 작품을 번역하고 있어요. 번역을 중단한 뒤 다시 제거해 주세요.';
  if (result.blockedBy === 'batch')
    return '이 작품을 미리 번역하고 있어요. 미리 번역을 중단한 뒤 다시 제거해 주세요.';
  return '작품을 제거하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
}

function SnackbarBridge({
  state,
  holdErrors,
  notice,
}: {
  state: RenewalSnapshot;
  holdErrors: boolean;
  notice: { id: number; text: string } | null;
}): null {
  const show = useSnackbar();
  const last = useRef({
    errorRevision: -1,
    titlesError: null as string | null,
    titlesRequestRevision: 0,
  });
  useEffect(() => {
    if (notice) show(notice.text);
  }, [notice, show]);
  useEffect(() => {
    if (state.chapterUpdates.notice) show(state.chapterUpdates.notice.text);
  }, [state.chapterUpdates.notice, show]);
  useEffect(() => {
    if (holdErrors) return;
    if (state.error && state.errorRevision !== last.current.errorRevision) show(state.error);
    if (state.titlesError && state.titlesError !== last.current.titlesError)
      show(state.titlesError);
    if ((state.titlesRequestRevision ?? 0) !== last.current.titlesRequestRevision)
      show('제목을 번역하고 있어요.');
    last.current = {
      errorRevision: state.errorRevision,
      titlesError: state.titlesError,
      titlesRequestRevision: state.titlesRequestRevision ?? 0,
    };
  }, [
    holdErrors,
    show,
    state.error,
    state.errorRevision,
    state.titlesRequestRevision,
    state.titlesError,
  ]);
  return null;
}
