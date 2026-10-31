// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { resolveTheme } from '../../src/ui/theme/theme';
import { SettingsScreen } from '../../src/ui/SettingsScreen';
import { createRenewalController } from '../../src/app/renewalController';
afterEach(cleanup);

describe('resolveTheme', () => {
  it('follows the system only for the system preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('SettingsScreen theme section', () => {
  it('offers the three theme choices and reports the selection', () => {
    const state = createRenewalController().getSnapshot();
    const onTheme = vi.fn();
    render(
      <SettingsScreen
        state={state}
        onChange={() => {}}
        onCheck={async () => ({ kind: 'superseded' as const })}
        onSelect={() => {}}
        onTheme={onTheme}
      />,
    );
    const themeRow = screen.getByRole('button', { name: '테마 시스템 설정 따르기' });
    expect(themeRow).toHaveAccessibleName('테마 시스템 설정 따르기');
    fireEvent.click(themeRow);
    const group = screen.getByRole('radiogroup', { name: '테마 선택' });
    expect(group).toBeVisible();
    expect(group.querySelectorAll('button')).toHaveLength(0);
    expect(group.querySelectorAll('input[type="radio"]')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: '시스템 설정 따르기' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: '다크' }));
    expect(onTheme).toHaveBeenCalledWith('dark');
  });

  it('새 테마를 라디오 클릭으로 고르면 onTheme을 한 번만 부른다', () => {
    const state = createRenewalController().getSnapshot();
    const onTheme = vi.fn();
    render(
      <SettingsScreen
        state={state}
        onChange={() => {}}
        onCheck={async () => ({ kind: 'superseded' as const })}
        onSelect={() => {}}
        onTheme={onTheme}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '테마 시스템 설정 따르기' }));
    fireEvent.click(screen.getByRole('radio', { name: '다크' }));
    expect(onTheme).toHaveBeenCalledTimes(1);
    expect(onTheme).toHaveBeenLastCalledWith('dark');
  });

  it('새 테마를 라벨 텍스트 클릭으로 고르면 onTheme을 한 번만 부른다', () => {
    const state = createRenewalController().getSnapshot();
    const onTheme = vi.fn();
    render(
      <SettingsScreen
        state={state}
        onChange={() => {}}
        onCheck={async () => ({ kind: 'superseded' as const })}
        onSelect={() => {}}
        onTheme={onTheme}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '테마 시스템 설정 따르기' }));
    fireEvent.click(screen.getByText('라이트'));
    expect(onTheme).toHaveBeenCalledTimes(1);
    expect(onTheme).toHaveBeenLastCalledWith('light');
  });

  it('이미 선택된 테마를 다시 누르면 onTheme을 한 번 부르고 대화상자를 닫는다', () => {
    const state = createRenewalController().getSnapshot();
    const onTheme = vi.fn();
    render(
      <SettingsScreen
        state={state}
        onChange={() => {}}
        onCheck={async () => ({ kind: 'superseded' as const })}
        onSelect={() => {}}
        onTheme={onTheme}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '테마 시스템 설정 따르기' }));
    fireEvent.click(screen.getByRole('radio', { name: '시스템 설정 따르기' }));
    expect(onTheme).toHaveBeenCalledTimes(1);
    expect(onTheme).toHaveBeenLastCalledWith('system');
    expect(screen.queryByRole('radiogroup', { name: '테마 선택' })).not.toBeInTheDocument();
  });
});
