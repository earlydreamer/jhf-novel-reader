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
}: {
  controller: RenewalController;
  state: RenewalSnapshot;
  urlDialogOpen: boolean;
  onCloseUrlDialog(): void;
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
}: {
  controller: RenewalController;
  state: RenewalSnapshot;
  onOpenUrlDialog(): void;
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
  const items = [{ label: '서재로 가기', onSelect: controller.goHome }];
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
        />
        <main ref={main} className="nr-screen">
          <RouteScreen
            controller={controller}
            state={state}
            urlDialogOpen={urlDialogOpen}
            onCloseUrlDialog={() => setUrlDialogOpen(false)}
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
