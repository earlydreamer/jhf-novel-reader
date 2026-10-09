// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GuidancePanel } from '../../src/ui/GuidancePanel';
import type { GuidanceDraft, WorkGuidance } from '../../src/translation/guidance';

afterEach(cleanup);

function guidanceWith(terms: WorkGuidance['terms']): WorkGuidance {
  return { schemaVersion: 1, workId: 'n1234ab', hash: 'hash', terms, voices: [] };
}

function renderPanel(value: WorkGuidance, onSave = vi.fn()) {
  const onRead = vi.fn().mockResolvedValue(value);
  onSave.mockImplementation(async (_workId: string, draft: GuidanceDraft) =>
    guidanceWith(draft.terms),
  );
  render(<GuidancePanel workId="n1234ab" locked={false} onRead={onRead} onSave={onSave} />);
  fireEvent.click(screen.getByText('작품 용어집·캐릭터 말투'));
  return onSave;
}

test('출처 배지는 자동 생성과 정밀스캔을 구분하고 사람 항목에는 붙지 않는다', async () => {
  renderPanel(
    guidanceWith([
      { source: 'アル', target: '아르', aliases: [], category: '', note: '', origin: 'model' },
      {
        source: 'アルベルト',
        target: '알베르트',
        aliases: [],
        category: '',
        note: '',
        origin: 'scan',
        evidence: [
          { kind: 'wikipedia', url: 'https://ja.wikipedia.org/wiki/x', note: '위키백과 표기' },
          { kind: 'model', note: '모델 표기 대조' },
        ],
      },
      { source: 'ミカエル', target: '미카엘', aliases: [], category: '', note: '' },
    ]),
  );
  expect(await screen.findByText('자동 생성')).toBeInTheDocument();
  expect(screen.getByText('정밀스캔')).toBeInTheDocument();
  expect(screen.getByText('위키백과 표기')).toBeInTheDocument();
  expect(screen.getByText('모델 표기 대조')).toBeInTheDocument();
  const link = screen.getByRole('link', { name: '출처' });
  expect(link).toHaveAttribute('href', 'https://ja.wikipedia.org/wiki/x');
  expect(link).toHaveAttribute('target', '_blank');
  expect(screen.getAllByText(/자동 생성|정밀스캔/)).toHaveLength(2);
});

test('자동 생성 항목의 한국어 표기를 고쳐 저장하면 출처가 사라진 사람 항목으로 넘어간다', async () => {
  const onSave = renderPanel(
    guidanceWith([
      {
        source: 'アルベルト',
        target: '알베르트',
        aliases: [],
        category: '',
        note: '',
        origin: 'model',
      },
      {
        source: 'ミナ',
        target: '미나',
        aliases: [],
        category: '',
        note: '',
        origin: 'scan',
        evidence: [{ kind: 'kanjidic', note: '근거' }],
      },
    ]),
  );
  await screen.findByText('자동 생성');
  fireEvent.change(screen.getByLabelText('용어 1 한국어 표기'), { target: { value: '알버트' } });
  fireEvent.click(screen.getByRole('button', { name: '용어집·말투 저장' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  const [, draft] = onSave.mock.calls[0] as [string, GuidanceDraft];
  expect(draft.terms[0]).toEqual({
    source: 'アルベルト',
    target: '알버트',
    aliases: [],
    category: '',
    note: '',
  });
  expect(draft.terms[0]).not.toHaveProperty('origin');
  expect(draft.terms[0]).not.toHaveProperty('evidence');
  expect(draft.terms[1]).toMatchObject({
    origin: 'scan',
    evidence: [{ kind: 'kanjidic', note: '근거' }],
  });
});
