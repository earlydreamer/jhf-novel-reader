import type { JSX } from 'react';
import { useEffect, useState } from 'react';

interface NoticeItem {
  name: string;
  version: string;
  license: string;
  textId: string;
}
interface NoticeSection {
  id: string;
  title: string;
  items: NoticeItem[];
}
interface NoticesData {
  sections: NoticeSection[];
  texts: Record<string, string>;
}

type LoadState =
  { status: 'loading' } | { status: 'ready'; data: NoticesData } | { status: 'failed' };

// 고지 JSON은 첫 화면 번들에 넣지 않고 대화상자를 열 때만 가져온다. CSP connect-src 'none'이라 fetch 대신 import를 쓴다.
export function LicensesList(): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    import('./licenses/notices.json').then(
      (module) => {
        if (active) setState({ status: 'ready', data: module.default as NoticesData });
      },
      () => {
        if (active) setState({ status: 'failed' });
      },
    );
    return () => {
      active = false;
    };
  }, []);

  if (state.status === 'loading') return <p role="status">라이선스 목록을 불러오고 있어요.</p>;
  if (state.status === 'failed') return <p role="alert">라이선스 목록을 불러오지 못했어요.</p>;

  const { data } = state;
  return (
    <>
      <p>
        이 앱에 포함된 오픈소스 구성 요소와 라이선스예요. JHF Novel Reader 자체 라이선스는 아직
        정하지 않았어요.
      </p>
      {data.sections.map((section) => (
        <section key={section.id}>
          <h3>{section.title}</h3>
          {section.items.map((item) => (
            <details key={`${section.id}-${item.name}-${item.version}`} className="nr-license">
              <summary>
                <span className="nr-license__name">{item.name}</span>
                <span className="nr-license__meta">
                  {item.version ? `${item.version} · ` : ''}
                  {item.license}
                </span>
              </summary>
              <pre className="nr-license__text">{data.texts[item.textId]}</pre>
            </details>
          ))}
        </section>
      ))}
    </>
  );
}
