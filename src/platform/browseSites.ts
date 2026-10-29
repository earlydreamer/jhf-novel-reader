/** 서재 사이트 선택에 쓰는 원문 탐색 사이트. 정본은 네이티브 SourceSites이며 테스트가 일치를 검사한다. */
export interface BrowseSite {
  id: string;
  label: string;
  startUrl: string;
  hosts: readonly string[];
}

export const BROWSE_SITES: readonly BrowseSite[] = [
  {
    id: 'narou',
    label: '나로우',
    startUrl: 'https://syosetu.com/',
    hosts: [
      'syosetu.com',
      'www.syosetu.com',
      'yomou.syosetu.com',
      'ncode.syosetu.com',
      'static.syosetu.com',
    ],
  },
  {
    id: 'kakuyomu',
    label: '카쿠요무',
    startUrl: 'https://kakuyomu.jp/',
    hosts: ['kakuyomu.jp', 'cdn-static.kakuyomu.jp'],
  },
  {
    id: 'pixiv',
    label: 'pixiv',
    startUrl: 'https://www.pixiv.net/novel',
    hosts: ['www.pixiv.net', 's.pximg.net', 'i.pximg.net', 'embed.pixiv.net'],
  },
];
