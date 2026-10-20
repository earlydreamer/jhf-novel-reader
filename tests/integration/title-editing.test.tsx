// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { Application } from '../../src/app/Application';
import { createRenewalController } from '../../src/app/renewalController';
import { ReaderError, type WorkPage } from '../../src/contracts';
import {
  createTitleRepository,
  displayedTitle,
  type TitleInput,
} from '../../src/translation/titles';

const work: WorkPage = {
  workId: 'n1234ab',
  canonicalUrl: 'https://ncode.syosetu.com/n1234ab/',
  pageUrl: 'https://ncode.syosetu.com/n1234ab/',
  title: '夏の物語',
  complete: true,
  nextPageUrl: null,
  chapters: Array.from({ length: 12 }, (_, i) => ({
    workId: 'n1234ab',
    chapterId: `n1234ab/${i + 1}`,
    canonicalUrl: `https://ncode.syosetu.com/n1234ab/${i + 1}/`,
    ordinal: i + 1,
    title: `夏の朝 ${i + 1}`,
  })),
};
function harness(automatic = false) {
  const bytes = new Map<string, string>();
  const files = {
    read: async (path: string) => bytes.get(path) ?? null,
    write: async (path: string, value: string) => {
      bytes.set(path, value);
    },
  };
  const repo = createTitleRepository(files);
  let page = structuredClone(work);
  const translateTitles = vi.fn(
    async (
      _selection: unknown,
      _work: string,
      inputs: readonly TitleInput[],
      _signal: AbortSignal,
    ): Promise<readonly (string | null)[]> =>
      inputs.map((input) =>
        input.key === work.workId ? '여름 이야기' : `여름 아침 ${input.key.split('/')[1]}`,
      ),
  );
  const startTranslation = vi.fn(async () => {});
  function create() {
    return createRenewalController({
      titles: repo,
      translateTitles,
      startTranslation,
      source: { getWorkPage: async () => structuredClone(page), getChapter: vi.fn() },
      catalog: async (connection) => ({
        connection,
        models: [
          {
            id: 'test-model',
            displayName: 'test-model',
            supportsGeneration: true,
            contextTokens: 8192,
          },
        ],
      }),
      settings: {
        readReadingSettings: async () => ({
          schemaVersion: 2,
          selection: null,
          fontSize: 18,
          autoTranslate: automatic,
        }),
        saveReadingSettings: async () => {},
      },
    });
  }
  async function ready(app = create()) {
    await app.initialize();
    app.changeConnection({ provider: 'openai-compatible', baseUrl: 'http://localhost:1234' });
    await app.checkConnection();
    app.chooseModel('test-model');
    await app.openWork(work.canonicalUrl);
    return app;
  }
  return {
    files,
    bytes,
    repo,
    translateTitles,
    startTranslation,
    ready,
    create,
    setPage(value: WorkPage) {
      page = value;
    },
  };
}
afterEach(cleanup);

test('다른 작품으로 이동하면 이전 제목 요청을 취소하고 종료된 뒤 새 작품만 번역한다', async () => {
  const h = harness(true);
  let finish!: () => void;
  h.translateTitles.mockImplementationOnce(async (_selection, _work, inputs) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return inputs.map(() => '이전 작품 응답');
  });
  const app = await h.ready();
  await waitFor(() => expect(h.translateTitles).toHaveBeenCalledTimes(1));
  const next: WorkPage = {
    ...work,
    workId: 'n5678cd',
    canonicalUrl: 'https://ncode.syosetu.com/n5678cd/',
    pageUrl: 'https://ncode.syosetu.com/n5678cd/',
    chapters: [],
  };
  h.setPage(next);
  await app.openWork(next.canonicalUrl);
  expect(h.translateTitles.mock.calls[0]![3].aborted).toBe(true);
  expect(h.translateTitles).toHaveBeenCalledTimes(1);
  finish();
  await waitFor(() => expect(app.getSnapshot().titlesBusy).toBe(false));
  expect(h.translateTitles.mock.calls.map((call) => call[1])).toEqual([work.workId, next.workId]);
  expect(app.getSnapshot().titles.some((entry) => entry.target === '이전 작품 응답')).toBe(false);
  app.dispose();
});

test('전송 전 기록 저장 중 취소한 제목은 재진입 때 정상 자동 번역한다', async () => {
  const h = harness(true);
  const record = h.repo.recordAttempt.bind(h.repo);
  let finish!: () => void;
  vi.spyOn(h.repo, 'recordAttempt').mockImplementationOnce(async (workId, inputs) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    await record(workId, inputs);
  });
  const app = await h.ready();
  await waitFor(() => expect(h.repo.recordAttempt).toHaveBeenCalledTimes(1));
  app.back();
  finish();
  await waitFor(() => expect(app.getSnapshot().titlesBusy).toBe(false));
  expect(h.translateTitles).not.toHaveBeenCalled();
  expect(await h.repo.readAttempts(work.workId)).toEqual([]);
  await app.openWork(work.canonicalUrl);
  await waitFor(() => expect(app.getSnapshot().titles).toHaveLength(13));
  expect(h.translateTitles).toHaveBeenCalledTimes(2);
  app.dispose();
});

test('전송하지 않은 오류는 다음 진입에서 복구하고 과거 기록만으로 미완료 오류를 띄우지 않는다', async () => {
  const h = harness(true);
  h.translateTitles.mockRejectedValueOnce(new ReaderError('connection', 'not_sent'));
  const app = await h.ready();
  await waitFor(() => expect(app.getSnapshot().titlesBusy).toBe(false));
  expect(await h.repo.readAttempts(work.workId)).toEqual([]);
  await app.openWork(work.canonicalUrl);
  await waitFor(() => expect(app.getSnapshot().titles).toHaveLength(13));
  expect(app.getSnapshot().titlesError).toBeNull();
  app.dispose();
});

test('미전송 기록 취소는 같은 키에 새로 기록한 다른 원문을 지우지 않는다', async () => {
  const h = harness();
  await h.repo.recordAttempt(work.workId, [{ key: work.workId, source: work.title }]);
  await h.repo.recordAttempt(work.workId, [{ key: work.workId, source: '冬の物語' }]);
  await h.repo.forgetAttempts!(work.workId, [{ key: work.workId, source: work.title }]);
  expect(await h.repo.readAttempts(work.workId)).toEqual([
    { key: work.workId, source: '冬の物語' },
  ]);
});
test('automatic titles arrive in small batches, cache across reopening and never start a body on the TOC', async () => {
  const h = harness(true);
  const app = await h.ready();
  await waitFor(() => expect(app.getSnapshot().titles).toHaveLength(13));
  expect(h.translateTitles.mock.calls.map((call) => call[2].length)).toEqual([8, 5]);
  expect(h.startTranslation).not.toHaveBeenCalled();
  await app.openWork(work.canonicalUrl);
  expect(h.translateTitles).toHaveBeenCalledTimes(2);
  app.dispose();
  const restarted = await h.ready();
  expect(restarted.getSnapshot().titles).toHaveLength(13);
  expect(h.translateTitles).toHaveBeenCalledTimes(2);
  restarted.dispose();
});

test('모델을 고르지 않아 실제 요청하지 않을 때 제목 번역 중 안내를 발행하지 않는다', async () => {
  const h = harness(true);
  const app = h.create();
  await app.initialize();
  const requests: number[] = [];
  const unsubscribe = app.subscribe(() =>
    requests.push(app.getSnapshot().titlesRequestRevision ?? 0),
  );
  await app.openWork(work.canonicalUrl);
  await waitFor(() => expect(app.getSnapshot().titlesBusy).toBe(false));
  expect(h.translateTitles).not.toHaveBeenCalled();
  expect(requests.every((revision) => revision === 0)).toBe(true);
  unsubscribe();
  app.dispose();
});

test('시도 기록 저장 대기에는 번역 안내가 없고 실제 번역 호출을 시작하면 안내한다', async () => {
  const h = harness(true);
  const record = h.repo.recordAttempt.bind(h.repo);
  let finish!: () => void;
  vi.spyOn(h.repo, 'recordAttempt').mockImplementationOnce(async (workId, inputs) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    await record(workId, inputs);
  });
  const app = await h.ready();
  render(<Application controller={app} />);
  expect(app.getSnapshot().titlesBusy).toBe(true);
  expect(h.translateTitles).not.toHaveBeenCalled();
  expect(screen.queryByText('제목을 번역하고 있어요.')).toBeNull();
  await act(async () => {
    finish();
  });
  await screen.findByText('제목을 번역하고 있어요.');
  await waitFor(() => expect(app.getSnapshot().titlesBusy).toBe(false));
  expect(h.translateTitles).toHaveBeenCalledTimes(2);
  expect(app.getSnapshot().titlesRequestRevision).toBe(1);
  app.dispose();
});

test.each([false, true])(
  '이전 제목 요청 중 펼친 다음 페이지를 누락하지 않고 결과 불명도 재전송하지 않는다 (unknown=%s)',
  async (unknown) => {
    const h = harness(true);
    const first = {
      ...work,
      chapters: work.chapters.slice(0, 4),
      complete: false,
      nextPageUrl: work.canonicalUrl + '?p=2',
    };
    const second = {
      ...work,
      chapters: work.chapters.slice(4, 8),
      pageUrl: first.nextPageUrl,
      nextPageUrl: null,
    };
    h.setPage(first);
    let finish!: () => void;
    h.translateTitles.mockImplementationOnce(async (_selection, _work, inputs) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      if (unknown) throw new ReaderError('timeout_unknown', 'unknown');
      return inputs.map(() => '첫 페이지 번역');
    });
    const app = await h.ready();
    await waitFor(() => expect(h.translateTitles).toHaveBeenCalledTimes(1));
    h.setPage(second);
    await app.loadMoreWorkPage();
    expect(app.getSnapshot().workViewport?.chapters).toHaveLength(4);
    expect(h.translateTitles.mock.calls[0]![3].aborted).toBe(true);
    expect(h.translateTitles).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(h.translateTitles).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(app.getSnapshot().titlesBusy).toBe(false));
    expect(h.translateTitles.mock.calls[1]![2].map((input) => input.key)).toEqual([
      'n1234ab/5',
      'n1234ab/6',
      'n1234ab/7',
      'n1234ab/8',
    ]);
    expect(app.getSnapshot().titles).toHaveLength(4);
    expect(h.startTranslation).not.toHaveBeenCalled();
    app.dispose();
    h.setPage(first);
    const restarted = await h.ready();
    await waitFor(() => expect(restarted.getSnapshot().titlesBusy).toBe(false));
    expect(h.translateTitles).toHaveBeenCalledTimes(2);
    restarted.dispose();
  },
);
test('automatic off sends no title request; explicit translation, editing and retranslation share one visible saved title', async () => {
  const h = harness();
  const app = await h.ready();
  render(<Application controller={app} />);
  expect(h.translateTitles).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '작품 제목 번역' }));
  await screen.findByRole('heading', { name: '여름 이야기' });
  expect(h.translateTitles.mock.calls[0]![2].map((input) => input.key)).toEqual([work.workId]);
  fireEvent.click(screen.getByRole('button', { name: '작품 제목 수정' }));
  fireEvent.change(screen.getByLabelText('작품 제목 번역문'), {
    target: { value: '내가 고친 작품명' },
  });
  fireEvent.click(screen.getByRole('button', { name: '제목 저장' }));
  await screen.findByRole('heading', { name: '내가 고친 작품명' });
  expect((await h.repo.read(work.workId))[0]!.origin).toBe('user');
  app.changeAutoTranslate(true);
  await waitFor(() => expect(app.getSnapshot().titles).toHaveLength(13));
  expect(app.getSnapshot().titles.find((title) => title.key === work.workId)!.target).toBe(
    '내가 고친 작품명',
  );
  fireEvent.click(screen.getByRole('button', { name: '작품 제목 재번역' }));
  await screen.findByRole('heading', { name: '여름 이야기' });
  app.dispose();
});
test('a chapter edit persists without model access and the untranslated source is retained', async () => {
  const h = harness();
  const app = await h.ready();
  render(<Application controller={app} />);
  fireEvent.click(screen.getByRole('button', { name: '2화 메뉴' }));
  fireEvent.click(screen.getByRole('button', { name: '제목 직접 수정하기' }));
  const panel = screen.getByRole('dialog', { name: '회차 제목 직접 수정하기' });
  expect(within(panel).getByText('원제: 夏の朝 2')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('2화 제목 번역문'), {
    target: { value: '직접 쓴 소제목' },
  });
  fireEvent.click(within(panel).getByRole('button', { name: '저장하기' }));
  await screen.findByRole('button', { name: '2화 직접 쓴 소제목' });
  expect(h.translateTitles).not.toHaveBeenCalled();
  app.dispose();
  const restarted = await h.ready();
  expect(displayedTitle(restarted.getSnapshot().titles, 'n1234ab/2', '夏の朝 2')).toBe(
    '직접 쓴 소제목',
  );
  expect(restarted.getSnapshot().work!.chapters[1]!.title).toBe('夏の朝 2');
  restarted.dispose();
});
test('a changed source invalidates only that title; a failed retranslation preserves the prior edit', async () => {
  const h = harness(true);
  const app = await h.ready();
  await waitFor(() => expect(app.getSnapshot().titles).toHaveLength(13));
  await app.saveTitle(work.workId, '보존할 제목');
  h.translateTitles.mockResolvedValueOnce([null]);
  await app.translateTitles(work.workId);
  expect(app.getSnapshot().titles.find((entry) => entry.key === work.workId)!.target).toBe(
    '보존할 제목',
  );
  const changed = structuredClone(work);
  changed.chapters[0]!.title = '冬の朝';
  h.setPage(changed);
  await app.openWork(work.canonicalUrl);
  await waitFor(() => expect(h.translateTitles).toHaveBeenCalledTimes(4));
  expect(h.translateTitles.mock.calls[3]![2]).toEqual([{ key: 'n1234ab/1', source: '冬の朝' }]);
  app.dispose();
});
test('an unknown request does not replay automatically even after restart, but explicit retry works', async () => {
  const h = harness(true);
  h.translateTitles.mockRejectedValueOnce(new ReaderError('timeout_unknown', 'unknown'));
  const app = await h.ready();
  await waitFor(() => expect(app.getSnapshot().titlesError).toContain('자동'));
  expect(h.translateTitles).toHaveBeenCalledTimes(1);
  app.dispose();
  const restarted = await h.ready();
  await waitFor(() => expect(restarted.getSnapshot().titlesBusy).toBe(false));
  expect(restarted.getSnapshot().titlesError).toBeNull();
  expect(
    h.translateTitles.mock.calls
      .slice(1)
      .flatMap((call) => call[2])
      .some((input) => input.key === work.workId),
  ).toBe(false);
  await restarted.translateTitles(work.workId);
  expect(restarted.getSnapshot().titles.find((entry) => entry.key === work.workId)!.target).toBe(
    '여름 이야기',
  );
  restarted.dispose();
});
test('a body request waits until the cancelled native title operation settles', async () => {
  const h = harness(true);
  let settle!: () => void;
  h.translateTitles.mockImplementationOnce(async (_selection, _work, inputs) => {
    await new Promise<void>((resolve) => {
      settle = resolve;
    });
    return inputs.map(() => '취소된 응답');
  });
  const app = await h.ready();
  await waitFor(() => expect(h.translateTitles).toHaveBeenCalledTimes(1));
  const selecting = app.selectChapter(work.chapters[0]!);
  await selecting;
  expect(h.startTranslation).not.toHaveBeenCalled();
  expect(h.translateTitles.mock.calls[0]![3].aborted).toBe(true);
  settle();
  await waitFor(() => expect(h.startTranslation).toHaveBeenCalledTimes(1));
  expect(app.getSnapshot().titles.some((entry) => entry.target === '취소된 응답')).toBe(false);
  app.dispose();
});
test('storage failure leaves the editor draft visible and does not change the title', async () => {
  const h = harness();
  const app = await h.ready();
  render(<Application controller={app} />);
  fireEvent.click(screen.getByRole('button', { name: '작품 제목 수정' }));
  fireEvent.change(screen.getByLabelText('작품 제목 번역문'), { target: { value: '저장할 제목' } });
  h.files.write = async () => {
    throw new Error('test I/O failure');
  };
  fireEvent.click(screen.getByRole('button', { name: '제목 저장' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('작품 제목 번역문')).toHaveValue('저장할 제목');
  expect(app.getSnapshot().titles).toHaveLength(0);
  app.dispose();
});
