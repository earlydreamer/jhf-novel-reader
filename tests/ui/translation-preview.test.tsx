// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TranslationScreen } from '../../src/ui/TranslationScreen';
import type { TranslationState } from '../../src/contracts/reading';
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
const view = (state: TranslationState) =>
  render(
    <TranslationScreen
      chapter={chapter}
      connection={connection}
      modelId="model"
      state={state}
      available={true}
      requestActive={state.phase === 'translating'}
      catalogReady={true}
      onTranslate={() => {}}
      onSettings={() => {}}
    />,
  );
it('shows the unsaved preview paragraphs while translating', () => {
  view({ phase: 'translating', elapsedMs: 0, preview: '첫 문단\n\n\n\n셋째 문단' });
  const region = screen.getByRole('region', { name: '미리보기 (저장 전)' });
  expect(region.textContent).toContain('첫 문단');
  expect(region.textContent).toContain('셋째 문단');
  expect(region.querySelectorAll('p')).toHaveLength(2);
  cleanup();
});
it('hides the preview once translation is no longer running', () => {
  view({ phase: 'failed', elapsedMs: 0, preview: '부분 번역' });
  expect(screen.queryByRole('region', { name: '미리보기 (저장 전)' })).toBeNull();
  cleanup();
});
