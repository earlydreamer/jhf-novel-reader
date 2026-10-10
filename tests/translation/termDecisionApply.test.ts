import { expect, test } from 'vitest';
import {
  appliedGuidance,
  appliedGuidanceHash,
  guidanceContext,
  type WorkGuidance,
} from '../../src/translation/guidance';
import { checkTranslationQuality } from '../../src/translation/quality';

const guidance: WorkGuidance = {
  schemaVersion: 1,
  workId: 'n1234ab',
  hash: 'hash',
  terms: [
    { source: 'ルシアナ', target: '루시아나', aliases: ['ルシア'], category: '', note: '' },
    { source: 'マリア', target: '마리아', aliases: ['マリ'], category: '', note: '' },
  ],
  voices: [],
};
// 'ルシア'와 'マリ'는 모두 뒤에 'ー'가 붙어 후보로만 등장한다.
const input = 'クルシアーノとマリーが来た。';
const decision = {
  confirmed: new Set(['ルシア']),
  rejected: new Set(['マリ']),
  judged: 2,
};

test('판정 전에는 두 후보 이름이 모두 후보 목록에 남는다', () => {
  expect(
    appliedGuidance(guidance, 'n1234ab', input, [])?.terms.map((t) => [
      t.term.source,
      t.names,
      t.candidateNames,
    ]),
  ).toEqual([
    ['ルシアナ', [], ['ルシア']],
    ['マリア', [], ['マリ']],
  ]);
});

test('확정된 후보는 확정 이름으로 옮기고, 제외된 후보는 빼며 남은 게 없는 항목은 뺀다', () => {
  expect(
    appliedGuidance(guidance, 'n1234ab', input, [], decision)?.terms.map((t) => [
      t.term.source,
      t.names,
      t.candidateNames,
    ]),
  ).toEqual([['ルシアナ', ['ルシア'], []]]);
});

test('참고 문구는 확정된 이름을 조건 없이 적는다', () => {
  const context = guidanceContext(guidance, 'n1234ab', input, [], decision);
  expect(context).toContain('ルシア translates to 루시아나\n');
  expect(context).not.toContain('only where');
  expect(context).not.toContain('マリ');
});

test('품질 검사는 확정된 이름만 표기 검사 대상으로 삼는다', () => {
  const blocks = [{ text: '마리가 왔다.' }];
  expect(
    checkTranslationQuality('n1234ab', input, blocks, guidance, [], decision).missingTerms,
  ).toEqual([{ source: 'ルシアナ', target: '루시아나' }]);
  expect(checkTranslationQuality('n1234ab', input, blocks, guidance, []).missingTerms).toEqual([]);
});

test('적용 해시는 판정 유무와 관계없이 같다', async () => {
  const hash = await appliedGuidanceHash(guidance, 'n1234ab', input, []);
  expect(hash).toBeDefined();
  // 해시 함수는 판정을 받지 않는다. 판정을 적용한 결과로 다시 계산해도 같은 값이어야 한다.
  appliedGuidance(guidance, 'n1234ab', input, [], decision);
  expect(await appliedGuidanceHash(guidance, 'n1234ab', input, [])).toBe(hash);
});
