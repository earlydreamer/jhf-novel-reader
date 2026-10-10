import type { TranslationQuality } from '../contracts/reading';
import { appliedGuidance, type GuidanceTerm, type WorkGuidance } from './guidance';

/** 가나만 감지한다. 한국어에도 쓰이는 한자나 장음 기호만으로는 잔존을 판정하지 않는다. */
export function japaneseBlockIndexes(blocks: readonly { text: string }[]): number[] {
  return blocks.flatMap((block, index) =>
    /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(block.text) ? [index] : [],
  );
}
/** 결과를 바꾸지 않는 결정론적 확인. 표기의 전체 부재만 잡으며 의미·말투 품질을 판정하지 않는다. */
export function checkTranslationQuality(
  workId: string,
  sourceInput: string,
  blocks: readonly { text: string }[],
  guidance: WorkGuidance | null,
  preset: readonly GuidanceTerm[] = [],
): TranslationQuality {
  const output = blocks
    .map((block) => block.text)
    .join('\n\n')
    .normalize('NFKC');
  // 확정 이름이 있는 항목만 검사한다. 후보로만 등장한 이름은 용어로 쓰였다고 볼 수 없다.
  const terms = (appliedGuidance(guidance, workId, sourceInput, preset)?.terms ?? []).filter(
    ({ names }) => names.length > 0,
  );
  return {
    ruleVersion: 'deterministic-v1',
    japaneseBlocks: japaneseBlockIndexes(blocks),
    missingTerms: terms
      .filter(({ term }) => !output.includes(term.target.normalize('NFKC')))
      .map(({ term }) => ({ source: term.source, target: term.target })),
  };
}
