// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BatchPanel } from '../../src/ui/BatchPanel';
import type { BatchRecord, BatchState } from '../../src/translation/batch';
import type { WorkPage } from '../../src/contracts/reading';

afterEach(cleanup);

const chapters = [3, 4, 5].map((ordinal) => ({
  workId: 'n1234ab',
  chapterId: `n1234ab/${ordinal}`,
  canonicalUrl: `https://ncode.syosetu.com/n1234ab/${ordinal}/`,
  title: `${ordinal}화 제목`,
  ordinal,
}));
const work: WorkPage = {
  workId: 'n1234ab',
  canonicalUrl: 'https://ncode.syosetu.com/n1234ab/',
  title: '합성 작품',
  chapters,
  pageUrl: 'https://ncode.syosetu.com/n1234ab/',
  nextPageUrl: null,
  complete: true,
};
function state(id: string, range: typeof chapters): BatchState {
  const record: BatchRecord = {
    schemaVersion: 1,
    id,
    createdAt: '2026-10-10T00:00:00Z',
    work,
    selection: {
      connection: { provider: 'openai-compatible', baseUrl: 'http://localhost:1234', revision: 1 },
      modelId: 'local',
    },
    chapters: range,
    retranslate: false,
    alreadySaved: 0,
    cursor: 0,
    completed: 0,
    skipped: 0,
    phase: 'prepared',
  };
  return { record, active: false, preparing: false, error: null };
}

test('기록이 없으면 시작은 1, 끝은 lastOrdinal이고 창 제목과 겹치는 h2는 없다(#270)', () => {
  render(<BatchPanel workId="n1234ab" batchAvailable lastOrdinal={42} />);
  expect(screen.getByLabelText('시작 회차')).toHaveValue(1);
  expect(screen.getByLabelText('끝 회차')).toHaveValue(42);
  expect(screen.queryByRole('heading', { name: '미리 번역하기' })).toBeNull();
});

test('기록이 있으면 그 범위를 채우고 기록이 바뀌면 칸도 갱신한다(#270)', () => {
  const { rerender } = render(
    <BatchPanel workId="n1234ab" batchAvailable lastOrdinal={42} batch={state('a', chapters)} />,
  );
  expect(screen.getByLabelText('시작 회차')).toHaveValue(3);
  expect(screen.getByLabelText('끝 회차')).toHaveValue(5);
  rerender(
    <BatchPanel
      workId="n1234ab"
      batchAvailable
      lastOrdinal={42}
      batch={state('b', chapters.slice(0, 2))}
    />,
  );
  expect(screen.getByLabelText('시작 회차')).toHaveValue(3);
  expect(screen.getByLabelText('끝 회차')).toHaveValue(4);
});
