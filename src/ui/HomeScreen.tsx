import { useState } from 'react';
import type { RenewalSnapshot } from '../app/renewalController';
export interface HomeScreenProps {
  recent: RenewalSnapshot['recent'];
  busy: boolean;
  sourceAvailable: boolean;
  onOpen(url: string): void;
  onContinue(versionId: string): void;
}
export function HomeScreen(props: HomeScreenProps) {
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
                {entry.workId} · {entry.chapterId} 이어 읽기
              </button>
            </li>
          ))}
        </ul>
      )}
      <h2>작품 탐색</h2>
      <p>앱 안의 나로우 탐색은 네이티브 탐색 연결 후 사용할 수 있습니다.</p>
      <button disabled>나로우에서 작품 찾기 (준비 중)</button>
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
