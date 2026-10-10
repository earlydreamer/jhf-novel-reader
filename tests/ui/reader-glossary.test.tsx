// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GuidanceTerm, WorkGuidance } from '../../src/translation/guidance';
import {
  removeTerm,
  sourceChips,
  termProblem,
  upsertTerm,
  useReaderGlossary,
} from '../../src/ui/readerGlossary';

const term = (source: string, target: string, extra: Partial<GuidanceTerm> = {}): GuidanceTerm => ({
  source,
  target,
  aliases: [],
  category: '',
  note: '',
  ...extra,
});

describe('readerGlossary', () => {
  it('추가는 끝에 사람 항목으로 넣는다', () => {
    const a = term('アル', '알');
    expect(upsertTerm([a], term('ベル', '벨'))).toEqual([a, term('ベル', '벨')]);
  });
  it('편집은 이전 이름의 항목을 바꾸고 별칭은 유지하며 기계 항목은 사람 항목이 된다', () => {
    const machine = term('ルシア', '루시아', {
      aliases: ['ルシアちゃん'],
      origin: 'scan',
      evidence: [{ kind: 'model', note: '근거' }],
    });
    const [edited] = upsertTerm(
      [machine],
      term('ルシアナ', '루시아나', { category: '인명' }),
      'ルシア',
    );
    expect(edited).toEqual({
      source: 'ルシアナ',
      target: '루시아나',
      aliases: ['ルシアちゃん'],
      category: '인명',
      note: '',
    });
  });
  it('삭제는 그 원문 항목만 뺀다', () => {
    const a = term('アル', '알');
    const b = term('ベル', '벨');
    expect(removeTerm([a, b], 'アル')).toEqual([b]);
  });
  it('검사 문구', () => {
    const terms = [term('ルシアナ', '루시아나', { aliases: ['ルシア'] })];
    expect(termProblem(terms, { source: ' ', target: '가' })).toBe(
      '원문과 번역 표기를 입력해 주세요.',
    );
    expect(termProblem(terms, { source: 'の', target: '가' })).toBe(
      '한 글자나 짧은 히라가나는 용어로 쓸 수 없어요.',
    );
    expect(termProblem(terms, { source: 'ルシア', target: '루시아' })).toBe(
      '이미 용어집에 있는 이름이에요.',
    );
    expect(termProblem(terms, { source: 'ルシアナ', target: '루시아나' }, 'ルシアナ')).toBeNull();
    expect(termProblem(terms, { source: 'ベル', target: '벨' })).toBeNull();
  });
  it('원문 칩은 가타카나·한자 덩어리 2글자 이상을 나온 순서로 최대 12개', () => {
    expect(sourceChips('剣聖オダ・ノブナガは王都で笑った。オダ・ノブナガ')).toEqual([
      '剣聖',
      'オダ・ノブナガ',
      '王都',
    ]);
    expect(sourceChips('あいう')).toEqual([]);
  });
  it('훅은 읽어 오고, 저장은 최신 용어집을 읽어 고친 뒤 저장한다', async () => {
    let stored: WorkGuidance = {
      schemaVersion: 1,
      workId: 'w',
      hash: 'h',
      terms: [term('アル', '알')],
      voices: [],
      plotSummary: '요약',
    };
    const read = vi.fn(async () => stored);
    const save = vi.fn(
      async (_workId: string, draft) => (stored = { ...stored, ...draft, hash: 'h2' }),
    );
    const { result } = renderHook(() =>
      useReaderGlossary({ workId: 'w', refreshKey: 'v1', read, save }),
    );
    await waitFor(() => expect(result.current?.terms).toHaveLength(1));
    let ok = false;
    await act(async () => {
      ok = await result.current!.saveTerm(term('ベル', '벨'));
    });
    expect(ok).toBe(true);
    expect(save.mock.calls[0]![1]).toEqual({
      terms: [term('アル', '알'), term('ベル', '벨')],
      voices: [],
      plotSummary: '요약',
    });
    expect(result.current!.terms).toHaveLength(2);
    await act(async () => {
      ok = await result.current!.deleteTerm('アル');
    });
    expect(result.current!.terms.map((t) => t.source)).toEqual(['ベル']);
  });
  it('저장이 실패하면 false를 돌려주고 목록은 그대로다', async () => {
    const stored: WorkGuidance = {
      schemaVersion: 1,
      workId: 'w',
      hash: 'h',
      terms: [],
      voices: [],
    };
    const { result } = renderHook(() =>
      useReaderGlossary({
        workId: 'w',
        read: async () => stored,
        save: async () => {
          throw new Error('locked');
        },
      }),
    );
    await waitFor(() => expect(result.current).toBeDefined());
    let ok = true;
    await act(async () => {
      ok = await result.current!.saveTerm(term('ベル', '벨'));
    });
    expect(ok).toBe(false);
    expect(result.current!.terms).toEqual([]);
  });
  it('workId나 read·save가 없으면 undefined', () => {
    const { result } = renderHook(() => useReaderGlossary({ workId: null }));
    expect(result.current).toBeUndefined();
  });
});
