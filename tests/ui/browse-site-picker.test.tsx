// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../src/platform/browseSites', () => ({
  BROWSE_SITES: [
    { id: 'a', label: '첫 사이트', startUrl: 'https://a.test/', hosts: ['a.test'] },
    { id: 'b', label: '둘째 사이트', startUrl: 'https://b.test/', hosts: ['b.test'] },
  ],
}));

import { Application } from '../../src/app/Application';
import { createRenewalController } from '../../src/app/renewalController';

afterEach(cleanup);

it('사이트가 여럿이면 목록 순서대로 펼치고 고른 사이트를 연다', async () => {
  const browse = vi.fn(async () => null);
  const controller = createRenewalController({ browse });
  render(<Application controller={controller} />);
  fireEvent.click(await screen.findByRole('button', { name: '작품 찾기' }));
  expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
    '첫 사이트',
    '둘째 사이트',
  ]);
  fireEvent.click(screen.getByRole('menuitem', { name: '둘째 사이트' }));
  await waitFor(() => expect(browse).toHaveBeenCalledExactlyOnceWith('https://b.test/'));
  controller.dispose();
});

it('목록을 닫으면 아무 사이트도 열지 않는다', async () => {
  const browse = vi.fn(async () => null);
  const controller = createRenewalController({ browse });
  render(<Application controller={controller} />);
  fireEvent.click(await screen.findByRole('button', { name: '작품 찾기' }));
  fireEvent.keyDown(screen.getAllByRole('menuitem')[0]!, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menuitem')).toBeNull());
  expect(browse).not.toHaveBeenCalled();
  controller.dispose();
});
