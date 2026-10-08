import type { JSX } from 'react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { HomeScreen } from '../ui/HomeScreen';
import { WorkScreen } from '../ui/WorkScreen';
import { TranslationScreen } from '../ui/TranslationScreen';
import { ReaderScreen } from '../ui/ReaderScreen';
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
import type { RenewalController, RenewalSnapshot } from './renewalController';
import '../ui/theme/base.css';
import './application.css';

function RouteScreen({
  controller,
  state,
  urlDialogOpen,
  onCloseUrlDialog,
  onRequestRemove,
}: {
  controller: RenewalController;
  state: RenewalSnapshot;
  urlDialogOpen: boolean;
  onCloseUrlDialog(): void;
  onRequestRemove(workId: string, title: string): void;
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
          titles={titles}
          work={state.work}
          savedChapterIds={state.savedChapterIds}
          selectedChapterId={state.route.selectedChapterId}
          busy={state.busy}
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
          batch={state.batch}
          batchAvailable={
            state.batchAvailable &&
            state.catalogStatus === 'connected' &&
            !!state.selectedModelId &&
            !state.translationActive
          }
          onPrepareBatch={(range, retranslate) => void controller.prepareBatch(range, retranslate)}
          onRunBatch={(retryUncertain) => void controller.runBatch(retryUncertain)}
          onScanBatch={() => void controller.scanBatch()}
          onConfirmBatchCandidates={(choices) => void controller.confirmBatchCandidates(choices)}
          onCancelBatch={controller.cancelBatch}
          onRetryBatchSave={() => void controller.retryBatchSave()}
          onSettings={() => controller.navigate({ kind: 'settings' })}
        />
      ) : (
        <p>작품 목차를 찾지 못했습니다.</p>
      );
    case 'translation':
      return state.chapter ? (
        <TranslationScreen
          titles={titles}
          key={state.chapter.chapterId}
          completedVersion={
            state.version?.source.chapterId === state.chapter.chapterId ? state.version : null
          }
          work={state.work}
          position={state.position}
          showOriginal={state.showOriginal}
          busy={state.busy}
          onShowOriginal={controller.showOriginal}
          onFontSize={controller.changeFontSize}
          onContents={controller.showContents}
          onAdjacent={controller.adjacentChapter}
          onRetryParagraphs={(indexes) => void controller.retryParagraphs(indexes)}
          streaming={
            state.paragraphRepair ||
            (state.translationMode === 'stream' &&
              state.connection.provider === 'openai-compatible')
          }
          fontSize={state.fontSize}
          onPreviewPosition={controller.previewPosition}
          chapter={state.chapter}
          connection={state.connection}
          modelId={state.selectedModelId}
          state={state.translation}
          available={state.translationAvailable}
          requestActive={state.translationActive}
          pendingSaveElsewhere={
            !!state.pendingSaveChapter &&
            state.pendingSaveChapter.chapterId !== state.chapter.chapterId
          }
          catalogReady={state.catalogStatus === 'connected'}
          catalogStatus={state.catalogStatus}
          onCheckConnection={() => void controller.checkConnection()}
          onCancel={controller.cancelTranslation}
          onRetry={() => void controller.retryTranslation()}
          onRetrySave={() => void controller.retrySave()}
          onOpenSaved={() => void controller.openSavedTranslation()}
          onTranslate={() => void controller.translate()}
          onSettings={() => controller.navigate({ kind: 'settings' })}
        />
      ) : (
        <p>선택한 회차를 찾지 못했습니다.</p>
      );
    case 'reader':
      return state.version ? (
        <ReaderScreen
          titles={titles}
          busy={state.busy || state.translationActive}
          onRetryParagraphs={
            state.streamingAvailable && state.connection.provider === 'openai-compatible'
              ? (indexes) => void controller.retryParagraphs(indexes)
              : undefined
          }
          key={state.version.versionId}
          version={state.version}
          work={state.work}
          position={state.position}
          fontSize={state.fontSize}
          showOriginal={state.showOriginal}
          sourceChange={state.sourceChange}
          onDisplayed={controller.readerDisplayed}
          onFontSize={controller.changeFontSize}
          onPosition={(block, offset) => void controller.savePosition(block, offset)}
          onShowOriginal={controller.showOriginal}
          onRefreshSource={() => void controller.refreshSource()}
          onContents={controller.showContents}
          onAdjacent={controller.adjacentChapter}
        />
      ) : (
        <p>저장된 번역을 찾지 못했습니다.</p>
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
}: {
  controller: RenewalController;
  state: RenewalSnapshot;
  onOpenUrlDialog(): void;
  onRequestRemove(workId: string, title: string): void;
}): JSX.Element {
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
  if (state.route.kind === 'work' && state.work)
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
  if (state.route.kind !== 'settings')
    items.push({ label: '설정', onSelect: () => controller.navigate({ kind: 'settings' }) });
  return (
    <TopAppBar
      title={routeTitles[state.route.kind]}
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
  const [removeTarget, setRemoveTarget] = useState<{
    workId: string;
    title: string;
    savedCount: number;
  } | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeFeedback, setRemoveFeedback] = useState<string | null>(null);
  const [removeNotice, setRemoveNotice] = useState<string | null>(null);
  const requestRemove = (workId: string, title: string) => {
    const row = state.libraryWorks.find((entry) => entry.work.workId === workId);
    const savedChapterIds =
      row?.savedChapterIds ?? (state.work?.workId === workId ? state.savedChapterIds : []);
    setRemoveTarget({ workId, title, savedCount: new Set(savedChapterIds).size });
    setRemoveFeedback(null);
    setRemoveNotice(null);
  };
  const confirmRemove = async () => {
    if (!removeTarget || removeBusy) return;
    setRemoveBusy(true);
    try {
      const result = await controller.removeWork(removeTarget.workId);
      if (result.removed === false) {
        setRemoveFeedback(
          result.blockedBy === 'pending_save'
            ? '저장하지 못한 번역이 있어요. 먼저 저장을 마친 뒤 다시 제거해 주세요.'
            : result.blockedBy === 'batch'
              ? '이 작품의 일괄 번역이 끝나지 않았어요. 번역을 마친 뒤 다시 제거해 주세요.'
              : result.blockedBy === 'unfinished_attempt'
                ? '요청 결과를 확인하지 못한 회차가 있어요. 지금은 작품을 제거할 수 없어요.'
                : result.blockedBy === 'translation'
                  ? '이 작품을 번역 중이에요. 번역을 마치거나 중단한 뒤 다시 제거해 주세요.'
                  : '작품을 제거하지 못했어요. 잠시 뒤 다시 시도해 주세요.',
        );
      } else if (result.removed === null) {
        setRemoveFeedback(
          '제거 여부를 확인하지 못했어요. 앱을 완전히 종료한 뒤 다시 열어 확인해 주세요.',
        );
      } else if (!result.cleanupComplete) {
        setRemoveTarget(null);
        setRemoveNotice('서재 목록에서는 제거했지만 저장 데이터 정리를 끝내지 못했어요.');
      } else {
        setRemoveTarget(null);
      }
    } finally {
      setRemoveBusy(false);
    }
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
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    platform.setSystemBarsTheme(theme);
  }, [theme, platform]);
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
      <SnackbarBridge state={state} holdErrors={urlDialogOpen && state.route.kind === 'home'} />
      <div className="nr-application" lang="ko">
        <ShellAppBar
          controller={controller}
          state={state}
          onOpenUrlDialog={() => setUrlDialogOpen(true)}
          onRequestRemove={requestRemove}
        />
        <main ref={main} className="nr-screen">
          <RouteScreen
            controller={controller}
            state={state}
            urlDialogOpen={urlDialogOpen}
            onCloseUrlDialog={() => setUrlDialogOpen(false)}
            onRequestRemove={requestRemove}
          />
          {state.translationTimings && (
            <details>
              <summary>최근 번역 단계별 시간</summary>
              <p>
                원문 준비 {Math.round(state.translationTimings.sourceMs)}ms · 모델 대기{' '}
                {Math.round(state.translationTimings.modelMs)}ms · 결과 확인·저장{' '}
                {Math.round(state.translationTimings.validationStorageMs)}ms · 리더 표시{' '}
                {Math.round(state.translationTimings.readerDisplayMs)}ms
              </p>
            </details>
          )}
        </main>
        <Dialog
          open={!!removeTarget}
          title={
            removeTarget ? `${removeTarget.title}을 서재에서 제거할까요?` : '작품을 제거할까요?'
          }
          onClose={() => {
            if (!removeBusy) {
              setRemoveTarget(null);
              setRemoveFeedback(null);
            }
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
              이 기기에 저장한 번역 {removeTarget.savedCount}화, 읽던 위치, 번역한 제목, 용어집이
              함께 삭제돼요. 삭제한 내용은 되돌릴 수 없어요.
            </p>
          )}
          {removeFeedback && <p role="alert">{removeFeedback}</p>}
        </Dialog>
        <Dialog
          open={removeNotice !== null}
          title="일부 데이터를 정리하지 못했어요"
          onClose={() => setRemoveNotice(null)}
          actions={
            <Button variant="text" onClick={() => setRemoveNotice(null)}>
              닫기
            </Button>
          }
        >
          <p>{removeNotice}</p>
        </Dialog>
      </div>
    </SnackbarProvider>
  );
}

function SnackbarBridge({
  state,
  holdErrors,
}: {
  state: RenewalSnapshot;
  holdErrors: boolean;
}): null {
  const show = useSnackbar();
  const last = useRef({
    errorRevision: -1,
    titlesError: null as string | null,
    titlesBusy: false,
  });
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
