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
        onCheck={async () => {}}
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
});
