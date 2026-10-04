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
          onFontSize={controller.changeFontSize}
          onPosition={(block, offset) => void controller.savePosition(block, offset)}
          onShowOriginal={controller.showOriginal}
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
      <RouteScreen controller={controller} state={state} />
    </main>
  );
}
