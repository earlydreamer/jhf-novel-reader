// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { WorkScreen } from '../../src/ui/WorkScreen';
it('shows the fetched TOC ordinal range without suggesting the first chapter is selected', () => {
  render(
    <WorkScreen
      work={{
        workId: 'n1234ab',
        canonicalUrl: 'https://ncode.syosetu.com/n1234ab/',
        title: '合成作品',
        pageUrl: 'https://ncode.syosetu.com/n1234ab/?p=2',
        nextPageUrl: 'https://ncode.syosetu.com/n1234ab/?p=3',
        complete: false,
        chapters: [
          {
            workId: 'n1234ab',
            chapterId: 'n1234ab/101',
            canonicalUrl: 'https://ncode.syosetu.com/n1234ab/101/',
            ordinal: 101,
            title: '百一話',
          },
          {
            workId: 'n1234ab',
            chapterId: 'n1234ab/102',
            canonicalUrl: 'https://ncode.syosetu.com/n1234ab/102/',
            ordinal: 102,
            title: '百二話',
          },
        ],
      }}
      busy={false}
      savedChapterIds={[]}
      onSelect={() => {}}
      onLoadMore={() => {}}
    />,
  );
  expect(screen.getByText('현재 확인한 범위: 101–102화 (2개 회차)')).toBeTruthy();
  expect(screen.queryByText('선택한 회차')).toBeNull();
  expect(screen.getByRole('link', { name: '현재 목차 원문' }).getAttribute('href')).toBe(
    'https://ncode.syosetu.com/n1234ab/?p=2',
  );
  cleanup();
});
