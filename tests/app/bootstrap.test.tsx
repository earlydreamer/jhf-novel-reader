// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';

const app = vi.hoisted(() => ({
  recover: vi.fn<() => Promise<void>>(),
  cleanup: vi.fn<() => Promise<void>>(),
  compose: vi.fn(() => ({})),
  render: vi.fn(),
}));
vi.mock('../../src/platform/backup', () => ({ recoverBackupBeforeStartup: app.recover }));
vi.mock('../../src/storage/credentialCleanup', () => ({
  cleanupNativeCredentialsBeforeStartup: app.cleanup,
}));
vi.mock('../../src/app/compose', () => ({ createNativeRenewalApplication: app.compose }));
vi.mock('../../src/app/Application', () => ({ Application: () => null }));
vi.mock('react-dom/client', () => ({ createRoot: () => ({ render: app.render }) }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  app.cleanup.mockResolvedValue();
  document.body.innerHTML = '<div id="root"></div>';
});

it('does not compose the controller or access storage until native recovery succeeds', async () => {
  let finish!: () => void;
  app.recover.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
  await import('../../src/app/bootstrap');
  expect(app.recover).toHaveBeenCalledOnce();
  expect(app.compose).not.toHaveBeenCalled();
  expect(app.cleanup).not.toHaveBeenCalled();
  expect(app.render).not.toHaveBeenCalled();
  finish();
  await vi.waitFor(() => expect(app.render).toHaveBeenCalledOnce());
  expect(app.compose).toHaveBeenCalledOnce();
});

it('keeps failed recovery blocked and lets a single retry recover without exposing storage', async () => {
  app.recover.mockRejectedValueOnce(new Error('private native details'));
  await import('../../src/app/bootstrap');
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain('저장 데이터를 안전하게 복구하지 못했어요'),
  );
  expect(document.body.textContent).not.toContain('private native details');
  expect(app.cleanup).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('앱 데이터를 지우지');
  expect(app.compose).not.toHaveBeenCalled();
  let finish!: () => void;
  app.recover.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
  const retry = document.querySelector('button')!;
  retry.click();
  retry.click();
  expect(app.recover).toHaveBeenCalledTimes(2);
  expect(app.compose).not.toHaveBeenCalled();
  finish();
  await vi.waitFor(() => expect(app.render).toHaveBeenCalledOnce());
  expect(app.compose).toHaveBeenCalledOnce();
});

it('waits for credential cleanup after recovery and before creating any controller', async () => {
  app.recover.mockResolvedValue();
  let finish!: () => void;
  app.cleanup.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
  await import('../../src/app/bootstrap');
  await vi.waitFor(() => expect(app.cleanup).toHaveBeenCalledOnce());
  expect(app.compose).not.toHaveBeenCalled();
  finish();
  await vi.waitFor(() => expect(app.compose).toHaveBeenCalledOnce());
});
