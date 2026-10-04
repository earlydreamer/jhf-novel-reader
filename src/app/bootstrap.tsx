import { createRoot } from 'react-dom/client';
export function FoundationApp() {
 return <main lang="ko"><h1>narou-reader</h1><p>Android 앱 기반을 준비하고 있습니다.</p><p>아직 번역 기능이 연결되지 않았습니다.</p></main>;
}
const container = typeof document === 'undefined' ? null : document.getElementById('root');
if (container) createRoot(container).render(<FoundationApp />);
