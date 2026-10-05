import { createRoot } from 'react-dom/client';
import { Application } from './Application';
import { createNativeRenewalApplication } from './compose';
// The trusted application composes native-only source, model and private storage adapters.
const container = typeof document === 'undefined' ? null : document.getElementById('root');
if (container)
  createRoot(container).render(<Application controller={createNativeRenewalApplication()} />);
