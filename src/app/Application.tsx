import type { JSX } from 'react';
import { useEffect, useSyncExternalStore } from 'react';
import { HomeScreen } from '../ui/HomeScreen';
import { WorkScreen } from '../ui/WorkScreen';
import { TranslationScreen } from '../ui/TranslationScreen';
import { ReaderScreen } from '../ui/ReaderScreen';
import { SettingsScreen } from '../ui/SettingsScreen';
import type { RenewalController, RenewalSnapshot } from './renewalController';
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
        />
      );
  }
}
export function Application({ controller }: { controller: RenewalController }): JSX.Element {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => {
    void controller.initialize();
  }, [controller]);
  return (
    <main className="nr-application" lang="ko">
      <header>
        <strong>narou-reader</strong>
        <nav aria-label="앱 이동">
          {state.route.kind !== 'home' && <button onClick={controller.back}>뒤로</button>}
          <button onClick={() => controller.navigate({ kind: 'home' })}>홈</button>
          {state.route.kind !== 'settings' && (
            <button onClick={() => controller.navigate({ kind: 'settings' })}>설정</button>
          )}
        </nav>
      </header>
      {state.error && <p role="alert">{state.error}</p>}
      {state.batch?.record &&
        state.batch.record.phase !== 'complete' &&
        (state.route.kind !== 'work' || state.route.workId !== state.batch.record.work.workId) && (
          <aside aria-label="일괄 번역 상태">
            <p>
              {state.batch.record.work.title}의 일괄 번역 상태가 저장되어 있습니다. 자동으로 다시
              전송하지 않습니다.
            </p>
            <button onClick={controller.openBatch}>일괄 번역 상태 보기</button>
          </aside>
        )}
      {state.legacyWarnings.length > 0 && (
        <aside aria-label="이전 읽기 데이터 확인" role="status">
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
          <aside aria-label="저장 대기 중인 번역">
            <p>
              {state.pendingSaveChapter.title}의 번역 결과가 아직 저장을 완료하지 못했습니다. 저장을
              마친 뒤 새 번역을 요청할 수 있습니다.
            </p>
            <button onClick={controller.openPendingSave}>저장 대기 중인 번역으로 돌아가기</button>
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
  );
}
