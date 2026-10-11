import { createRoot } from 'react-dom/client';
import { Application } from './Application';
import { createNativeRenewalApplication } from './compose';
import { recoverBackupBeforeStartup } from '../platform/backup';
// The trusted application composes native-only source, model and private storage adapters.
const container = typeof document === 'undefined' ? null : document.getElementById('root');
if (container) {
  const rootContainer = container;
  let recovering = false;
  async function start() {
    if (recovering) return;
    recovering = true;
    rootContainer.textContent = '저장 데이터를 확인하고 있어요.';
    try {
      await recoverBackupBeforeStartup();
    } catch {
      recovering = false;
      const message = document.createElement('p');
      message.setAttribute('role', 'alert');
      message.textContent =
        '저장 데이터를 안전하게 복구하지 못했어요. 저장 공간을 확보한 뒤 다시 시도해 주세요. 계속 실패하면 앱 데이터를 지우지 말고 개발자에게 복구를 요청해 주세요.';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = '복구 다시 시도';
      retry.onclick = () => void start();
      rootContainer.replaceChildren(message, retry);
      return;
    }
    createRoot(rootContainer).render(<Application controller={createNativeRenewalApplication()} />);
  }
  void start();
}
