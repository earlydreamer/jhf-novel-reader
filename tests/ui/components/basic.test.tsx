// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Button } from '../../../src/ui/components/Button';
import { IconButton } from '../../../src/ui/components/IconButton';
import { Chip } from '../../../src/ui/components/Chip';
import { Card } from '../../../src/ui/components/Card';
import { ListItem } from '../../../src/ui/components/ListItem';
afterEach(cleanup);

describe('Button', () => {
  it('defaults to a small non-submitting button and exposes its variant', () => {
    const onClick = vi.fn();
    render(
      <form
        onSubmit={() => {
          throw new Error('submitted');
        }}
      >
        <Button variant="tonal" onClick={onClick}>
          미리 번역하기
        </Button>
      </form>,
    );
    const button = screen.getByRole('button', { name: '미리 번역하기' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('nr-button', 'nr-button--tonal', 'nr-button--s');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
  it('supports the medium filled primary action and danger tone', () => {
    render(
      <>
        <Button variant="filled" size="m">
          12화부터 이어서 읽기
        </Button>
        <Button variant="filled" tone="danger">
          제거하기
        </Button>
      </>,
    );
    expect(screen.getByRole('button', { name: '12화부터 이어서 읽기' })).toHaveClass('nr-button--m');
    expect(screen.getByRole('button', { name: '제거하기' })).toHaveClass('nr-button--danger');
  });
});

describe('IconButton', () => {
  it('requires a label and reflects pressed state', () => {
    render(<IconButton icon="settings" label="설정" pressed={false} />);
    const button = screen.getByRole('button', { name: '설정' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button.querySelector('.nr-icon')).toHaveAttribute('aria-hidden', 'true');
  });
  it('omits aria-pressed when it is not a toggle', () => {
    render(<IconButton icon="close" label="닫기" />);
    expect(screen.getByRole('button', { name: '닫기' })).not.toHaveAttribute('aria-pressed');
  });
});

describe('Chip and Card', () => {
  it('filter chip exposes selection', () => {
    render(<Chip label="세피아" selected onClick={() => {}} />);
    expect(screen.getByRole('button', { name: '세피아' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('interactive card is a button and static card is not', () => {
    const onClick = vi.fn();
    render(
      <>
        <Card variant="tonal" onClick={onClick} label="이어서 읽기 작품 A">
          이어서 읽기
        </Card>
        <Card variant="error">저장하지 못했어요</Card>
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: '이어서 읽기 작품 A' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByText('저장하지 못했어요').closest('button')).toBeNull();
  });
});

describe('ListItem', () => {
  it('keeps the main action and trailing action as sibling buttons', () => {
    const onClick = vi.fn();
    render(
      <ListItem
        headline="마을의 아침"
        supporting="12화 · 오늘 읽음"
        current
        onClick={onClick}
        trailing={<IconButton icon="more_vert" label="12화 더보기" />}
      />,
    );
    const main = screen.getByRole('button', { name: /마을의 아침/ });
    expect(main).toHaveAttribute('aria-current', 'true');
    expect(main).toHaveAccessibleName('마을의 아침 12화 · 오늘 읽음');
    expect(main.contains(screen.getByRole('button', { name: '12화 더보기' }))).toBe(false);
    fireEvent.click(main);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
