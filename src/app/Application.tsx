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
  switch (state.route.kind) {
    case 'home':
      return (
        <HomeScreen
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
          work={state.work}
          savedChapterIds={state.savedChapterIds}
          selectedChapterId={state.route.selectedChapterId}
          busy={state.busy}
          onSelect={(chapter) => void controller.selectChapter(chapter)}
          onLoadMore={() => void controller.loadMoreWorkPage()}
        />
      ) : (
        <p>작품 목차를 찾지 못했습니다.</p>
      );
    case 'translation':
      return state.chapter ? (
        <TranslationScreen
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
