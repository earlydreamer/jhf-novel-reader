import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FoundationApp } from '../../src/app/bootstrap';
it('renders a safe foundation shell without claiming translation works', () => {
 const html = renderToStaticMarkup(<FoundationApp />);
 expect(html).toContain('narou-reader');
 expect(html).toContain('아직 번역 기능이 연결되지 않았습니다');
 expect(html).not.toContain('<iframe');
});
