// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TranslationScreen } from '../../src/ui/TranslationScreen';
const chapter = {
  workId: 'n1234ab',
  chapterId: 'n1234ab/1',
  canonicalUrl: 'https://ncode.syosetu.com/n1234ab/1/',
  ordinal: 1,
  title: '一話',
};
const connection = {
  provider: 'openai-compatible' as const,
  baseUrl: 'http://127.0.0.1:1234',
  revision: 0,
};
const state = { phase: 'idle' as const, elapsedMs: 0 };
it('explains that the server connection is not confirmed', () => {
  render(
    <TranslationScreen
      chapter={chapter}
      connection={connection}
      modelId={null}
      state={state}
      available={true}
      requestActive={false}
      catalogReady={false}
      onTranslate={() => {}}
      onSettings={() => {}}
    />,
  );
  expect(
    screen.getByText('서버 연결이 확인되지 않았습니다. 연결 설정에서 서버 주소를 확인하세요.'),
  ).toBeTruthy();
  cleanup();
});
it('explains that no generation model is selected when the catalog is ready', () => {
  render(
    <TranslationScreen
      chapter={chapter}
      connection={connection}
      modelId={null}
      state={state}
      available={true}
      requestActive={false}
      catalogReady={true}
      onTranslate={() => {}}
      onSettings={() => {}}
    />,
  );
  expect(
    screen.getByText('생성 모델이 선택되지 않았습니다. 연결 설정에서 모델을 선택하세요.'),
  ).toBeTruthy();
  cleanup();
});
