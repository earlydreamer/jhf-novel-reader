// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import arrowBack from '../../../src/ui/icons/arrow_back.svg';
import { Icon } from '../../../src/ui/components/Icon';
afterEach(cleanup);
it('renders a decorative masked icon with its name and size', () => {
  const { container } = render(<Icon name="arrow_back" size={20} />);
  const icon = container.querySelector('.nr-icon') as HTMLElement;
  expect(icon).toHaveAttribute('aria-hidden', 'true');
  expect(icon).toHaveAttribute('data-icon', 'arrow_back');
  expect(icon.style.getPropertyValue('--nr-icon-size')).toBe('20px');
  // Vite는 작은 SVG를 data URI로 인라인하므로 경로 대신 가져온 에셋 값과 직접 비교한다.
  expect(icon.style.getPropertyValue('--nr-icon')).toBe(`url("${arrowBack}")`);
});
