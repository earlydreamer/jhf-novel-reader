import { expect, it, vi } from 'vitest';
import { createRenewalController } from '../../src/app/renewalController';
import { ReaderError } from '../../src/contracts';

it('지원하지 않는 작품은 안내하고 저장하지 않는다', async () => {
  const getWorkPage = vi.fn(async () => {
    throw new ReaderError('source_unsupported', 'received');
  });
  const controller = createRenewalController({
    source: { getWorkPage, getChapter: vi.fn() },
    streamingAvailable: true,
  });
  await controller.initialize();
  await controller.openWork('https://www.pixiv.net/novel/show.php?id=5');
  expect(getWorkPage).toHaveBeenCalledTimes(1);
  expect(controller.getSnapshot()).toMatchObject({
    busy: false,
    work: null,
    error: '로그인이 필요하거나 성인·일본어 외 작품이라 열 수 없어요.',
  });
});

it('다른 원문 오류는 기존 안내를 유지한다', async () => {
  const controller = createRenewalController({
    source: {
      getWorkPage: vi.fn(async () => {
        throw new ReaderError('source_access', 'received', 404);
      }),
      getChapter: vi.fn(),
    },
    streamingAvailable: true,
  });
  await controller.initialize();
  await controller.openWork('https://www.pixiv.net/novel/show.php?id=5');
  expect(controller.getSnapshot().error).toBe(
    '작품 제목과 목차를 불러오지 못했어요. 원문 주소를 확인하고 다시 시도해 주세요.',
  );
});
