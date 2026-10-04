import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Application } from '../../src/app/legacy/Application';
it('renders a truthful native-only shell with source access and rights limits', () => {
 const html = renderToStaticMarkup(<Application controller={null} />);
 expect(html).toContain('narou-reader');
 expect(html).toContain('Android 네이티브 앱');
 expect(html).toContain('접근과 번역이 허용된');
 expect(html).toContain('로그인');
 expect(html).not.toContain('<iframe');
 expect(html).not.toContain('아직 번역 기능이 연결되지 않았습니다');
});
