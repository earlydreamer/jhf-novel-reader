import { createRoot } from 'react-dom/client';
import { Application } from './Application';
import { createNativeReaderApplication } from './compose';
const container = typeof document === 'undefined' ? null : document.getElementById('root');
if (container) createRoot(container).render(<Application controller={createNativeReaderApplication()} />);
