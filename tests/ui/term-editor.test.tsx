// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GuidanceTerm } from '../../src/translation/guidance';
import { TermEditor, type TermEditorProps } from '../../src/ui/TermEditor';

afterEach(() => {
  cleanup();
});

const term = (source: string, target: string, extra: Partial<GuidanceTerm> = {}): GuidanceTerm => ({
  source,
  target,
  aliases: [],
  category: '',
  note: '',
  ...extra,
});

function editor(overrides: Partial<TermEditorProps> = {}): TermEditorProps {
  return {
    open: true,
    mode: 'add',
    terms: [],
    locked: false,
    onCancel: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  };
}

describe('TermEditor', () => {
  it('추가 모드에서 원문 문단의 칩을 보여 주고 누르면 원문에 넣는다', () => {
    render(<TermEditor {...editor({ sourceText: '剣聖オダ・ノブナガは王都で笑った。' })} />);

    expect(screen.getByRole('dialog', { name: '용어 추가하기' })).toBeInTheDocument();
    expect(screen.getByText('원문 문단에서 이름을 골라 넣을 수 있어요.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '剣聖' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'オダ・ノブナガ' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '王都' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'オダ・ノブナガ' }));
    expect(screen.getByLabelText('원문')).toHaveValue('オダ・ノブナガ');
  });

  it('원문과 번역 표기가 비어 있으면 저장하지 않고 안내한다', () => {
    const onSave = vi.fn();
    render(<TermEditor {...editor({ onSave })} />);

    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(screen.getByRole('alert')).toHaveTextContent('원문과 번역 표기를 입력해 주세요.');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('입력한 값을 정리해 새 항목으로 저장한다', () => {
    const onSave = vi.fn();
    render(<TermEditor {...editor({ onSave })} />);

    fireEvent.change(screen.getByLabelText('원문'), { target: { value: 'ベル' } });
    fireEvent.change(screen.getByLabelText('번역 표기'), { target: { value: '벨' } });
    fireEvent.change(screen.getByLabelText('분류 (선택)'), { target: { value: '인명' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(onSave).toHaveBeenCalledWith(
      { source: 'ベル', target: '벨', aliases: [], category: '인명', note: '' },
      undefined,
    );
  });

  it('편집 모드는 기존 값으로 채우고 칩 없이 이전 원문과 별칭을 함께 넘긴다', () => {
    const onSave = vi.fn();
    const initial = term('ルシア', '루시아', { aliases: ['ルシアちゃん'], note: '메모' });
    render(<TermEditor {...editor({ mode: 'edit', initial, onSave })} />);

    expect(screen.getByRole('dialog', { name: '용어 편집하기' })).toBeInTheDocument();
    expect(screen.getByLabelText('원문')).toHaveValue('ルシア');
    expect(screen.getByLabelText('번역 표기')).toHaveValue('루시아');
    expect(screen.getByLabelText('메모 (선택)')).toHaveValue('메모');
    expect(screen.queryByText('원문 문단에서 이름을 골라 넣을 수 있어요.')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('번역 표기'), { target: { value: '루시아나' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(onSave).toHaveBeenCalledWith(
      {
        source: 'ルシア',
        target: '루시아나',
        aliases: ['ルシアちゃん'],
        category: '',
        note: '메모',
      },
      'ルシア',
    );
  });

  it('다른 항목과 겹치는 원문은 저장하지 않는다', () => {
    const onSave = vi.fn();
    render(<TermEditor {...editor({ onSave, terms: [term('ベル', '벨')] })} />);

    fireEvent.change(screen.getByLabelText('원문'), { target: { value: 'ベル' } });
    fireEvent.change(screen.getByLabelText('번역 표기'), { target: { value: '벨 씨' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(screen.getByRole('alert')).toHaveTextContent('이미 용어집에 있는 이름이에요.');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('번역 중에는 안내를 보이고 저장을 막는다', () => {
    render(
      <TermEditor {...editor({ mode: 'edit', initial: term('ルシア', '루시아'), locked: true })} />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('번역 중에는 용어집을 고칠 수 없어요.');
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
  });
});
