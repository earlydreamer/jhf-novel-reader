import { ReaderError } from '../contracts';
import type { LocalTranslationLimits, SourceSnapshot } from '../contracts/reading';

export const DEFAULT_LOCAL_LIMITS: LocalTranslationLimits = {
  contextTokens: 8192,
  inputBudgetTokens: 2048,
  maxOutputTokens: 4096,
};
export function validLocalLimits(value: unknown): value is LocalTranslationLimits {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (!('contextTokens' in value) || typeof value.contextTokens !== 'number') return false;
  if (!('inputBudgetTokens' in value) || typeof value.inputBudgetTokens !== 'number') return false;
  if (!('maxOutputTokens' in value) || typeof value.maxOutputTokens !== 'number') return false;
  return (
    [value.contextTokens, value.inputBudgetTokens, value.maxOutputTokens].every(
      Number.isSafeInteger,
    ) &&
    value.contextTokens >= 1024 &&
    value.contextTokens <= 262144 &&
    value.inputBudgetTokens >= 512 &&
    value.inputBudgetTokens <= 32768 &&
    value.maxOutputTokens >= 256 &&
    value.maxOutputTokens <= 65536 &&
    value.inputBudgetTokens + value.maxOutputTokens + 512 <= value.contextTokens
  );
}
/** Reported server capacity is authoritative; unknown servers use a conservative profile. */
export function limitsForModel(
  modelId: string,
  serverContextTokens?: number,
): LocalTranslationLimits {
  const modelContextTokens = /hy[-_]?mt2/i.test(modelId) ? 8192 : 262144;
  const contextTokens = Math.min(serverContextTokens ?? 4096, modelContextTokens);
  if (!Number.isSafeInteger(contextTokens) || contextTokens < 2048)
    throw new ReaderError('input_limit');
  let inputBudgetTokens = 2048;
  if (contextTokens < 8192) inputBudgetTokens = 1024;
  if (contextTokens < 4096) inputBudgetTokens = 512;
  // 용량 미확인·Hy-MT2는 기존 가드를 유지하고, 용량이 보고된 범용 모델은 출력에 약 2/3를 예약한다.
  const proportional = serverContextTokens !== undefined && !/hy[-_]?mt2/i.test(modelId);
  if (proportional) inputBudgetTokens = Math.min(32768, Math.floor((contextTokens - 512) / 3));
  const maxOutputTokens = Math.min(
    proportional ? 65536 : 4096,
    contextTokens - inputBudgetTokens - 512,
  );
  const limits = { contextTokens, inputBudgetTokens, maxOutputTokens };
  if (!validLocalLimits(limits)) throw new ReaderError('input_limit');
  return limits;
}
export function chapterAtoms(source: SourceSnapshot): string[] {
  const atoms: string[] = [];
  source.paragraphs.forEach((paragraph, index) => {
    if (index) atoms.push('\n\n');
    let cursor = 0;
    for (const ruby of [...paragraph.ruby].sort((left, right) => left.start - right.start)) {
      if (
        !Number.isSafeInteger(ruby.start) ||
        !Number.isSafeInteger(ruby.end) ||
        ruby.start < cursor ||
        ruby.end <= ruby.start ||
        ruby.end > paragraph.text.length ||
        !ruby.reading.trim()
      )
        throw new ReaderError('source_parse');
      atoms.push(...Array.from(paragraph.text.slice(cursor, ruby.start).replace(/\r\n/g, '\n')));
      atoms.push(paragraph.text.slice(ruby.start, ruby.end) + '《' + ruby.reading + '》');
      cursor = ruby.end;
    }
    atoms.push(...Array.from(paragraph.text.slice(cursor).replace(/\r\n/g, '\n')));
  });
  return atoms;
}
