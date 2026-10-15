// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { GuidanceDialog } from '../../src/ui/GuidanceDialog';
import { WorkScreen } from '../../src/ui/WorkScreen';
import { runTopBackHandler } from '../../src/ui/shell/backStack';
import {
  GuidanceConflictError,
  type GuidanceDraft,
  type WorkGuidance,
} from '../../src/translation/guidance';

afterEach(cleanup);
const value: WorkGuidance = {
  schemaVersion: 1,
  workId: 'n1234ab',
  hash: 'h1',
  voices: [],
  plotSummary: '기존 요약',
  terms: [{ source: 'アルベルト', target: '알베르트', aliases: [], category: '', note: '' }],
};

test('작품의 직접 버튼은 읽기 실패를 덮어쓰지 않고 다시 읽기로 복구한다', async () => {
  const onRead = vi.fn().mockRejectedValueOnce(new Error('read')).mockResolvedValue(value);
  const onSave = vi.fn();
  render(
    <WorkScreen
      work={{
        workId: 'n1234ab',
        canonicalUrl: 'https://ncode.syosetu.com/n1234ab/',
        title: '합성 작품',
        pageUrl: 'https://ncode.syosetu.com/n1234ab/',
        nextPageUrl: null,
        complete: true,
        chapters: [],
      }}
      busy={false}
      savedChapterIds={[]}
      onSelect={() => {}}
      onLoadMore={() => {}}
      guidance={{ locked: false, onRead, onSave }}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '용어집 편집하기' }));
  await screen.findByText('저장한 용어집을 읽지 못했어요. 기존 데이터는 덮어쓰지 않아요.');
  expect(screen.getByRole('button', { name: '저장하기' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '닫기' }));
  fireEvent.click(screen.getByRole('button', { name: '용어집 편집하기' }));
  fireEvent.click(screen.getByRole('button', { name: '용어집 다시 읽기' }));
  expect(await screen.findByLabelText('용어 1 한국어 표기')).toHaveValue('알베르트');
  expect(onRead).toHaveBeenCalledTimes(2);
  expect(onSave).not.toHaveBeenCalled();
});

test('뒤로가기는 초안 폐기 확인을 열고 저장 실패와 충돌에서도 초안을 보존한다', async () => {
  const onSave = vi
    .fn()
    .mockRejectedValueOnce(new Error('disk'))
    .mockRejectedValueOnce(new GuidanceConflictError());
  const onRead = vi.fn().mockResolvedValue(value);
  function Harness() {
    const [open, setOpen] = useState(true);
    return open ? (
      <GuidanceDialog
        workId={value.workId}
        locked={false}
        onRead={onRead}
        onSave={onSave}
        onClose={() => setOpen(false)}
      />
    ) : null;
  }
  render(<Harness />);
  const input = await screen.findByLabelText('용어 1 한국어 표기');
  fireEvent.change(input, { target: { value: '알버트' } });
  act(() => {
    expect(runTopBackHandler()).toBe(true);
  });
  expect(screen.getByRole('dialog', { name: '변경 사항을 버릴까요?' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '계속 편집하기' }));
  fireEvent.click(screen.getByRole('button', { name: '저장하기' }));
  await screen.findByText(/저장하지 못했어요. 필수 항목/);
  expect(input).toHaveValue('알버트');
  expect(screen.queryByText(/저장했어요. 다음 번역/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '저장하기' }));
  await screen.findByText(/다른 작업에서 용어집이 바뀌었어요/);
  expect(input).toHaveValue('알버트');
  expect(onSave).toHaveBeenLastCalledWith(
    value.workId,
    expect.objectContaining({ plotSummary: '기존 요약' }),
    'h1',
  );
  expect(screen.getByRole('button', { name: '저장하기' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '입력한 변경을 버리고 다시 읽기' }));
  await waitFor(() => expect(input).toHaveValue('알베르트'));
  fireEvent.click(screen.getByRole('button', { name: '닫기' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('열린 초안은 외부 갱신으로 사라지지 않고 잠금 중에는 저장하지 않는다', async () => {
  const onRead = vi.fn().mockResolvedValue(value);
  const onSave = vi.fn(async (_id: string, draft: GuidanceDraft) => ({
    ...value,
    ...draft,
    hash: 'h2',
  }));
  const onClose = vi.fn();
  const view = render(
    <GuidanceDialog
      workId={value.workId}
      locked={false}
      onRead={onRead}
      onSave={onSave}
      onClose={onClose}
    />,
  );
  const input = await screen.findByLabelText('용어 1 한국어 표기');
  fireEvent.change(input, { target: { value: '알버트' } });
  view.rerender(
    <GuidanceDialog
      workId={value.workId}
      locked
      refreshKey="scan-result"
      onRead={onRead}
      onSave={onSave}
      onClose={onClose}
    />,
  );
  await screen.findByText(/다른 작업에서 용어집이 바뀌었어요/);
  expect(input).toHaveValue('알버트');
  const dialog = screen.getByRole('dialog', { name: '작품 용어집' });
  expect(within(dialog).getByRole('button', { name: '저장하기' })).toBeDisabled();
  expect(onRead).toHaveBeenCalledTimes(1);
  expect(onSave).not.toHaveBeenCalled();
});
