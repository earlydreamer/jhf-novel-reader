import { createRoot } from 'react-dom/client';
import { Application } from './Application';
import { createRenewalController } from './renewalController';
// Native source, provider and library integration arrives in T4. Never dispatch legacy jobs.
const container = typeof document === 'undefined' ? null : document.getElementById('root');
if (container) createRoot(container).render(<Application controller={createRenewalController()} />);
