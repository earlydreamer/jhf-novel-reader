// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { ReaderScreen } from '../../src/ui/ReaderScreen';
import { CandidateReview } from '../../src/ui/CandidateReview';
import type { CompletedTranslation } from '../../src/contracts';
import { source } from '../providers/wholeChapterFixture';
afterEach(cleanup);
const version: CompletedTranslation = {
  schemaVersion: 2,
  versionId: 'quality-v1',
  source,
  text: 'ふと 멈췄다.',
  blocks: [{ id: 'b1', text: 'ふと 멈췄다.' }],
  createdAt: '2026-10-08T00:00:00Z',
  provenance: {
    provider: 'openai-compatible',
    connectionId: 'local',
    modelId: 'synthetic',
    contractVersion: 'plain-v1',
    promptVersion: 'hymt2-ko-v1',
    languageDirection: 'ja-ko',
  },
};
test('legacy quality fallback marks kana and warning navigation switches to unchanged translation at its saved block', () => {
  const onPosition = vi.fn(),
    onShowOriginal = vi.fn();
  render(
    <ReaderScreen
      version={version}
      work={null}
      position={null}
      fontSize={18}
      showOriginal={true}
      sourceChange="idle"
      onPosition={onPosition}
      onShowOriginal={onShowOriginal}
      onFontSize={() => {}}
      onRefreshSource={() => {}}
      onContents={() => {}}
      onAdjacent={() => {}}
    />,
  );
  expect(
    screen.getByText('이 저장본은 용어 확인 기록이 없어 가나 잔존만 확인했습니다.'),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole('button', { name: '가나가 남은 1번째 문단 보기', hidden: true }),
  );
  expect(onShowOriginal).toHaveBeenCalledWith(false);
  expect(onPosition).toHaveBeenCalledWith('b1', 0);
  expect(version.text).toBe('ふと 멈췄다.');
});
test('candidate selections survive pagination and source names cannot collide with object prototype keys', () => {
  const candidates = Array.from({ length: 21 }, (_, index) => ({
    source: index === 0 ? 'constructor' : `候補${index}`,
    kind: 'ruby' as const,
    count: 1,
    chapterIds: ['c1'],
  }));
  const onConfirm = vi.fn();
  render(<CandidateReview candidates={candidates} disabled={false} onConfirm={onConfirm} />);
  expect(screen.getByLabelText('constructor 사용')).not.toBeChecked();
  fireEvent.click(screen.getByLabelText('constructor 사용'));
  fireEvent.change(screen.getByLabelText('constructor 한국어 표기'), {
    target: { value: '생성자' },
  });
  fireEvent.click(screen.getByRole('button', { name: '다음 후보' }));
  fireEvent.click(screen.getByLabelText('候補20 사용'));
  fireEvent.change(screen.getByLabelText('候補20 한국어 표기'), { target: { value: '후보20' } });
  fireEvent.click(screen.getByRole('button', { name: '선택한 2개 표기 확정' }));
  expect(onConfirm).toHaveBeenCalledWith([
    { source: 'constructor', target: '생성자' },
    { source: '候補20', target: '후보20' },
  ]);
});
