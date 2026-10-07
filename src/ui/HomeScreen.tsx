import type { JSX } from 'react';
import { useState } from 'react';
import type { RenewalSnapshot } from '../app/renewalController';
export interface HomeScreenProps {
  recent: RenewalSnapshot['recent'];
  recentTitles?: Readonly<Record<string, string>>;
  busy: boolean;
  sourceAvailable: boolean;
  onBrowse?(): void;
  onOpen(url: string): void;
  onContinue(versionId: string): void;
}
export function HomeScreen(props: HomeScreenProps): JSX.Element {
  const [url, setUrl] = useState('');
  return (
    <section aria-label="홈">
      <h1>이어 읽기</h1>
      {props.recent.length === 0 ? (
        <p>아직 읽은 작품이 없습니다. 작품을 찾아 목차에서 회차를 선택하세요.</p>
      ) : (
        <ul>
          {props.recent.map((entry) => (
            <li key={entry.versionId}>
              <button onClick={() => props.onContinue(entry.versionId)}>
                {props.recentTitles?.[entry.workId] ?? entry.workId} ·{' '}
                {props.recentTitles?.[entry.chapterId] ?? entry.chapterId} 이어 읽기
              </button>
            </li>
          ))}
        </ul>
      )}
      <h2>작품 탐색</h2>
      <p>앱 안에서 검색·랭킹·분류로 작품을 찾고, 원하는 회차를 선택하세요.</p>
      <button
        disabled={props.busy || !props.sourceAvailable || !props.onBrowse}
        onClick={props.onBrowse}
      >
        나로우에서 작품 찾기
      </button>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          props.onOpen(url);
        }}
      >
        <label>
          작품 또는 회차 URL
          <input type="url" required value={url} onChange={(event) => setUrl(event.target.value)} />
        </label>
        <button disabled={props.busy || !props.sourceAvailable}>작품 열기</button>
      </form>
      {!props.sourceAvailable && (
        <p role="status">
          원문 연결은 아직 사용할 수 없습니다. 저장된 번역은 연결 없이 읽을 수 있습니다.
        </p>
      )}
    </section>
  );
}
