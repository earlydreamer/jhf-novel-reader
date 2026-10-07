import { expect, test } from 'vitest';
import { estimatePromptTokens, hasCalibratedEstimator } from '../../src/translation/tokenEstimate';
import { limitsForModel, validLocalLimits } from '../../src/translation/segments';
import { estimatedLineTokens, lineUnits, planLineBatches } from '../../src/translation/lines';
import { source } from '../providers/wholeChapterFixture';

const model = '/home/models/gemma-4-E4B-it-UD-Q4_K_XL.gguf';
test('확인한 E4B만 보정하며 다른 모델과 기존 호출자는 바이트 추정으로 남는다', () => {
  expect(hasCalibratedEstimator(model)).toBe(true);
  expect(hasCalibratedEstimator('google/gemma-4-e4b')).toBe(true);
  for (const id of [
    'gemma-4-26b',
    'gemma-3-e4b',
    'hy-mt2',
    'Index-Translate-9B',
    'my-gemma-4-e4b-test',
  ])
    expect(hasCalibratedEstimator(id)).toBe(false);
  const text = '夏の朝、ユキは図書館へ歩いた。';
  const old = new TextEncoder().encode(text).length + 128;
  expect(estimatePromptTokens(text, 'unknown')).toBe(old);
  expect(estimatePromptTokens(text, model)).toBeLessThan(old);
  // 4.52B/토큰 평균을 영문·숫자·희귀 기호에 일괄 적용하지 않는다.
  for (const text of ['AZ09'.repeat(100), '𠮷🪼'.repeat(100)])
    expect(estimatePromptTokens(text, model)).toBe(new TextEncoder().encode(text).length + 128);
});

test('보고된 컨텍스트에 비례해 입력·출력을 예약하고 미확인 용량과 Hy-MT2 가드를 보존한다', () => {
  const contexts = [2048, 4096, 8192, 16384, 32768, 131072, 262144];
  const budgets = contexts.map((context) => limitsForModel(model, context));
  for (const limits of budgets) {
    expect(validLocalLimits(limits)).toBe(true);
    expect(limits.inputBudgetTokens + limits.maxOutputTokens + 512).toBeLessThanOrEqual(
      limits.contextTokens,
    );
  }
  expect(budgets.map((b) => b.inputBudgetTokens)).toEqual(
    [...budgets.map((b) => b.inputBudgetTokens)].sort((a, b) => a - b),
  );
  expect(limitsForModel(model, 16384)).toEqual({
    contextTokens: 16384,
    inputBudgetTokens: 5290,
    maxOutputTokens: 10582,
  });
  expect(limitsForModel(model).inputBudgetTokens).toBe(1024);
  expect(limitsForModel('hy-mt2', 131072)).toEqual({
    contextTokens: 8192,
    inputBudgetTokens: 2048,
    maxOutputTokens: 4096,
  });
});

test('보정된 묶음은 요청 수를 줄여도 원문·순서·참고 데이터를 그대로 포함한다', () => {
  const chapter = {
    ...source,
    paragraphs: Array.from({ length: 100 }, (_, i) => ({
      id: `p${i}`,
      text: '夏の朝、ユキは図書館で二冊の本を読みました。'.repeat(3),
      ruby: [],
    })),
  };
  const oldLimits = { contextTokens: 16384, inputBudgetTokens: 2048, maxOutputTokens: 4096 };
  const limits = limitsForModel(model, 16384);
  const reference = 'Reference the following translations:\nユキ translates to 유키\n\n';
  const units = lineUnits(chapter, limits, reference, model);
  const batches = planLineBatches(units, limits, reference, model);
  expect(batches.length).toBeLessThan(
    planLineBatches(lineUnits(chapter, oldLimits, reference), oldLimits, reference).length,
  );
  expect(
    batches
      .flat()
      .map((u) => u.text)
      .join(''),
  ).toBe(chapter.paragraphs.map((p) => p.text).join(''));
  expect(
    batches.every((b) => estimatedLineTokens(b, reference, model) <= limits.inputBudgetTokens),
  ).toBe(true);
});
