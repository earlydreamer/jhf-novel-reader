// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { CandidateReview } from '../../src/ui/CandidateReview';
afterEach(cleanup);
test('candidate selections survive pagination and source names cannot collide with object prototype keys', () => {
  const candidates = Array.from({ length: 21 }, (_, index) => ({
    source: index === 0 ? 'constructor' : `候補${index}`,
    kind: 'ruby' as const,
    count: 1,
    chapterIds: ['c1'],
  }));
  const onConfirm = vi.fn();
  render(<CandidateReview candidates={candidates} disabled={false} onConfirm={onConfirm} />);
  expect(screen.getByLabelText('constructor 사용')).not.toBeChecked();
  fireEvent.click(screen.getByLabelText('constructor 사용'));
  fireEvent.change(screen.getByLabelText('constructor 한국어 표기'), {
    target: { value: '생성자' },
  });
  fireEvent.click(screen.getByRole('button', { name: '다음 후보' }));
  fireEvent.click(screen.getByLabelText('候補20 사용'));
  fireEvent.change(screen.getByLabelText('候補20 한국어 표기'), { target: { value: '후보20' } });
  fireEvent.click(screen.getByRole('button', { name: '선택한 2개 표기 확정' }));
  expect(onConfirm).toHaveBeenCalledWith([
    { source: 'constructor', target: '생성자' },
    { source: '候補20', target: '후보20' },
  ]);
});
