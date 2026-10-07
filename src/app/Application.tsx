import type { JSX } from 'react';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { HomeScreen } from '../ui/HomeScreen';
import { WorkScreen } from '../ui/WorkScreen';
import { TranslationScreen } from '../ui/TranslationScreen';
import { ReaderScreen } from '../ui/ReaderScreen';
import { SettingsScreen } from '../ui/SettingsScreen';
import { TopAppBar } from '../ui/components/TopAppBar';
import { IconButton } from '../ui/components/IconButton';
import { Menu } from '../ui/components/Menu';
import { Card } from '../ui/components/Card';
import { Button } from '../ui/components/Button';
import { SnackbarProvider } from '../ui/components/Snackbar';
import { runTopBackHandler } from '../ui/shell/backStack';
import { useResolvedTheme } from '../ui/theme/theme';
import { capacitorShell, type ShellPlatform } from '../platform/shell';
import type { RenewalController, RenewalSnapshot } from './renewalController';
import '../ui/theme/base.css';
import './application.css';

function RouteScreen({
  controller,
  state,
}: {
  controller: RenewalController;
  state: RenewalSnapshot;
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
          recentTitles={state.recentTitles}
          recent={state.recent}
          busy={state.busy}
          sourceAvailable={state.sourceAvailable}
          onBrowse={() => void controller.browse()}
          onOpen={(url) => void controller.openWork(url)}
          onContinue={(id) => void controller.continueReading(id)}
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
}: {
  controller: RenewalController;
  state: RenewalSnapshot;
}): JSX.Element {
  if (state.route.kind === 'home')
    return (
      <TopAppBar
        title="서재"
        titleAs="span"
        actions={
          <IconButton
            icon="settings"
            label="설정"
            onClick={() => controller.navigate({ kind: 'settings' })}
          />
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
    <SnackbarProvider>
      <div className="nr-application" lang="ko">
        <ShellAppBar controller={controller} state={state} />
        <main ref={main} className="nr-screen">
          {state.error && (
            <Card variant="error" role="alert">
              {state.error}
            </Card>
          )}
          {/* 아래 알림 카드들은 #93(서재)에서 서재 화면으로 옮긴다. 문구는 그 이슈에서 바꾼다. */}
          {state.batch?.record &&
            state.batch.record.phase !== 'complete' &&
            (state.route.kind !== 'work' ||
              state.route.workId !== state.batch.record.work.workId) && (
              <aside aria-label="일괄 번역 상태" className="nr-notice">
                <p>
                  {state.batch.record.work.title}의 일괄 번역 상태가 저장되어 있습니다. 자동으로
                  다시 전송하지 않습니다.
                </p>
                <Button variant="text" onClick={controller.openBatch}>
                  일괄 번역 상태 보기
                </Button>
              </aside>
            )}
          {state.legacyWarnings.length > 0 && (
            <aside aria-label="이전 읽기 데이터 확인" role="status" className="nr-notice">
              <p>이전 읽기 데이터 일부를 가져오지 못했습니다. 원본 파일은 그대로 보존했습니다.</p>
              <ul>
                {state.legacyWarnings.map((warning) => (
                  <li key={warning.cacheKey}>
                    기록 {warning.cacheKey.slice(3, 15)}:{' '}
                    {warning.reason === 'unfinished'
                      ? '미완료 번역입니다. 자동으로 번역을 재개하지 않습니다.'
                      : warning.reason === 'missing'
                        ? '저장 파일을 찾을 수 없습니다.'
                        : '손상되었거나 지원하지 않는 형식입니다.'}
                  </li>
                ))}
              </ul>
            </aside>
          )}
          {state.pendingSaveChapter &&
            (state.route.kind !== 'translation' ||
              state.route.chapterId !== state.pendingSaveChapter.chapterId) && (
              <aside aria-label="저장 대기 중인 번역" className="nr-notice nr-notice--error">
                <p>
                  {state.pendingSaveChapter.title}의 번역 결과가 아직 저장을 완료하지 못했습니다.
                  저장을 마친 뒤 새 번역을 요청할 수 있습니다.
                </p>
                <Button variant="text" onClick={controller.openPendingSave}>
                  저장 대기 중인 번역으로 돌아가기
                </Button>
              </aside>
            )}
          {state.titlesBusy && <p role="status">제목 번역 중… 완료된 제목부터 표시합니다.</p>}
          {state.titlesError && <p role="alert">{state.titlesError}</p>}
          <RouteScreen controller={controller} state={state} />
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
