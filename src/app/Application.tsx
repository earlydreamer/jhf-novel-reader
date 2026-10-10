import type { JSX } from 'react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { HomeScreen } from '../ui/HomeScreen';
import { WorkScreen } from '../ui/WorkScreen';
import { ImmersiveReader } from '../ui/ImmersiveReader';
import { SettingsScreen } from '../ui/SettingsScreen';
import { TopAppBar } from '../ui/components/TopAppBar';
import { IconButton } from '../ui/components/IconButton';
import { Menu } from '../ui/components/Menu';
import type { MenuItem } from '../ui/components/Menu';
import { Button } from '../ui/components/Button';
import { Dialog } from '../ui/components/Modal';
import { SnackbarProvider, useSnackbar } from '../ui/components/Snackbar';
import { runTopBackHandler } from '../ui/shell/backStack';
import { useResolvedTheme } from '../ui/theme/theme';
import { capacitorShell, type ShellPlatform } from '../platform/shell';
import type { WorkRemovalResult } from '../contracts/reading';
import type { RenewalController, RenewalSnapshot } from './renewalController';
import '../ui/theme/base.css';
import './application.css';

function RouteScreen({
  controller,
  state,
  urlDialogOpen,
  onCloseUrlDialog,
  onRequestRemove,
  workDialogRequest,
  onWorkDialogRequestHandled,
}: {
  controller: RenewalController;
  state: RenewalSnapshot;
  urlDialogOpen: boolean;
  onCloseUrlDialog(): void;
  onRequestRemove(workId: string, title: string): void;
  workDialogRequest: {
    dialog: 'guidance' | 'batch' | 'termScan';
    id: number;
    workId: string;
  } | null;
  onWorkDialogRequestHandled(id: number): void;
}): JSX.Element {
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
          onRequestRemove={onRequestRemove}
          onContinue={(id) => void controller.continueReading(id)}
          onOpenPendingSave={controller.openPendingSave}
          onOpenBatch={controller.openBatch}
          legacyWarnings={state.legacyWarnings}
        />
      );
    case 'work':
      return state.work ? (
        <WorkScreen
          key={state.work.workId}
          titles={titles}
          work={state.work}
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
                  locked: state.busy || state.translationActive,
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
          showOriginal={state.showOriginal}
          sourceChange={state.sourceChange}
          busy={state.busy || state.translationActive}
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
          onLookupWikipedia={controller.changeLookupWikipedia}
          onLookupNamuwiki={controller.changeLookupNamuwiki}
          onTheme={controller.changeTheme}
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
  onOpenWorkDialog,
}: {
  controller: RenewalController;
  state: RenewalSnapshot;
  onOpenUrlDialog(): void;
  onRequestRemove(workId: string, title: string): void;
  onOpenWorkDialog(dialog: 'guidance' | 'batch' | 'termScan'): void;
}): JSX.Element | null {
  if (state.route.kind === 'home')
    return (
      <TopAppBar
        title="서재"
        titleAs="span"
        actions={
          <>
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
      actions={<Menu label="더보기" items={items} />}
    />
  );
}

export function Application({
  controller,
  platform = capacitorShell,
}: {
  controller: RenewalController;
  platform?: ShellPlatform;
}): JSX.Element {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
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
  const [removalNotice, setRemovalNotice] = useState<{ id: number; text: string } | null>(null);
  const removalNoticeSequence = useRef(0);
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
    removalNoticeSequence.current += 1;
    setRemovalNotice({ id: removalNoticeSequence.current, text: message });
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
        notice={removalNotice}
      />
      <div className="nr-application" lang="ko">
        <ShellAppBar
          controller={controller}
          state={state}
          onOpenUrlDialog={() => setUrlDialogOpen(true)}
          onRequestRemove={requestRemove}
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
            urlDialogOpen={urlDialogOpen}
            onCloseUrlDialog={() => setUrlDialogOpen(false)}
            onRequestRemove={requestRemove}
            workDialogRequest={workDialogRequest}
            onWorkDialogRequestHandled={handleWorkDialogRequestHandled}
          />
        </main>
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
    titlesBusy: false,
  });
  useEffect(() => {
    if (notice) show(notice.text);
  }, [notice, show]);
  useEffect(() => {
    if (holdErrors) return;
    if (state.error && state.errorRevision !== last.current.errorRevision) show(state.error);
    if (state.titlesError && state.titlesError !== last.current.titlesError)
      show(state.titlesError);
    if (state.titlesBusy && !last.current.titlesBusy) show('제목을 번역하고 있어요.');
    last.current = {
      errorRevision: state.errorRevision,
      titlesError: state.titlesError,
      titlesBusy: state.titlesBusy,
    };
  }, [holdErrors, show, state.error, state.errorRevision, state.titlesBusy, state.titlesError]);
  return null;
}
