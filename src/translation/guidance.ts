import { ReaderError } from '../contracts';
import { digest, Journal, serial, type PrivateFiles } from '../storage/journal';
import { check, object } from '../storage/validation';
import { identifier } from '../storage/readingValidation';

export type GuidanceTerm = {
  source: string;
  target: string;
  aliases: string[];
  category: string;
  note: string;
  /** 'auto'는 작품 스캔이 찾은 미확정 후보다. 확정 전에는 주입·적용 해시에서 모두 빠진다. */
  origin?: 'auto';
};
export type GuidanceVoice = { name: string; aliases: string[]; instruction: string };
export type GuidanceDraft = { terms: GuidanceTerm[]; voices: GuidanceVoice[] };
export type WorkGuidance = GuidanceDraft & { schemaVersion: 1; workId: string; hash: string };
export interface GuidanceRepository {
  read(workId: string): Promise<WorkGuidance | null>;
  save(workId: string, draft: GuidanceDraft): Promise<WorkGuidance>;
}
function string(value: unknown, maximum: number, required = false): asserts value is string {
  check(typeof value === 'string' && value.length <= maximum && (!required || !!value.trim()));
  check(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));
}
function aliases(value: unknown): void {
  check(Array.isArray(value) && value.length <= 8);
  value.forEach((alias) => string(alias, 80, true));
}
export async function validateGuidance(value: unknown): Promise<WorkGuidance> {
  object(value, ['schemaVersion', 'workId', 'hash', 'terms', 'voices']);
  check(value.schemaVersion === 1);
  identifier(value.workId);
  // 저장 개수 상한은 두지 않는다. 주입이 구간 등장분만이라 저장량이 입력 예산을 쓰지 않는다.
  check(Array.isArray(value.terms));
  check(Array.isArray(value.voices));
  for (const term of value.terms) {
    object(term, ['source', 'target', 'aliases', 'category', 'note', 'origin']);
    check(term.origin === undefined || term.origin === 'auto');
    string(term.source, 80, true);
    string(term.target, 80, true);
    aliases(term.aliases);
    string(term.category, 40);
    string(term.note, 300);
  }
  for (const voice of value.voices) {
    object(voice, ['name', 'aliases', 'instruction']);
    string(voice.name, 80, true);
    aliases(voice.aliases);
    string(voice.instruction, 400, true);
  }
  check(value.hash === (await digest([value.workId, value.terms, value.voices])));
  return value as unknown as WorkGuidance;
}
export function createGuidanceRepository(files: PrivateFiles): GuidanceRepository {
  const journal = new Journal(files);
  return {
    read(workId) {
      identifier(workId);
      return serial(files, async () => {
        const record = (await journal.load(`guidance/${workId}`, validateGuidance))?.value ?? null;
        check(!record || record.workId === workId);
        return record;
      });
    },
    async save(workId, draft) {
      duplicateFree(draft);
      const value: WorkGuidance = {
        ...structuredClone(draft),
        schemaVersion: 1,
        workId,
        hash: await digest([workId, draft.terms, draft.voices]),
      };
      await serial(files, () => journal.save(`guidance/${workId}`, value, validateGuidance));
      return value;
    },
  };
}
/** 전각·반각 차이 등을 같게 보는 이름 비교 키. */
const nameKey = (name: string) => name.normalize('NFKC');
/** 같은 목록 안에서 정규화한 이름(원문·별칭)이 겹치면 저장을 거부한다. */
function duplicateFree(draft: GuidanceDraft): void {
  for (const names of [
    draft.terms.flatMap((term) => [term.source, ...term.aliases]),
    draft.voices.flatMap((voice) => [voice.name, ...voice.aliases]),
  ]) {
    const keys = names.map(nameKey);
    check(new Set(keys).size === keys.length);
  }
}
export function guidanceHash(value: WorkGuidance | null | undefined): string | undefined {
  return value && (value.terms.length || value.voices.length) ? value.hash : undefined;
}
/** 긴 이름부터 매칭하고 그 구간을 가려서, 긴 이름 안에 포함된 짧은 이름이 따로 매칭되지 않게 한다. */
function matchedNames(input: string, names: string[]): Set<string> {
  let masked = input;
  const matched = new Set<string>();
  for (const name of [...new Set(names)].sort((left, right) => right.length - left.length)) {
    if (!masked.includes(name)) continue;
    matched.add(name);
    masked = masked.split(name).join('\u0000'.repeat(name.length));
  }
  return matched;
}
type AppliedGuidance = {
  terms: { term: GuidanceTerm; names: string[] }[];
  voices: GuidanceVoice[];
};
/** 입력에 실제로 등장한 용어(등장한 이름 포함)와 말투만 고른다. 주입 형식과 적용 해시가 같은 매칭을 쓴다. */
export function appliedGuidance(
  value: WorkGuidance | null,
  workId: string,
  input: string,
  preset: readonly GuidanceTerm[],
): AppliedGuidance | null {
  if (value && value.workId !== workId) throw new ReaderError('storage');
  const workTerms = (value?.terms ?? []).filter((term) => term.origin !== 'auto');
  const workKeys = new Set(
    workTerms.flatMap((term) => [term.source, ...term.aliases]).map(nameKey),
  );
  // 작품 용어가 같은 원문을 가지면 프리셋 항목 대신 작품 항목을 쓴다.
  const candidates = [
    ...workTerms,
    ...preset.filter((term) => !workKeys.has(nameKey(term.source))),
  ];
  const voiceList = value?.voices ?? [];
  // 용어와 말투는 따로 가린다. 같은 인물의 용어 별칭(긴 이름)이 말투 이름(짧은 이름)을 가리면 말투 지시가 빠진다.
  const termNames = matchedNames(
    input,
    candidates.flatMap((term) => [term.source, ...term.aliases]),
  );
  const voiceNames = matchedNames(
    input,
    voiceList.flatMap((voice) => [voice.name, ...voice.aliases]),
  );
  const terms = candidates
    .map((term) => ({
      term,
      names: [term.source, ...term.aliases].filter((name) => termNames.has(name)),
    }))
    .filter((entry) => entry.names.length);
  const voices = voiceList.filter((voice) =>
    [voice.name, ...voice.aliases].some((name) => voiceNames.has(name)),
  );
  return terms.length || voices.length ? { terms, voices } : null;
}
export function guidanceContext(
  value: WorkGuidance | null,
  workId: string,
  input: string,
  preset: readonly GuidanceTerm[] = [],
): string {
  const applied = appliedGuidance(value, workId, input, preset);
  if (!applied) return '';
  const terms = applied.terms.flatMap(({ term, names }) =>
    names.map(
      (name) => `${name} translates to ${term.target}${term.note ? ` (${term.note})` : ''}`,
    ),
  );
  const voices = applied.voices.map((voice) => `${voice.name}: ${voice.instruction}`);
  return (
    (terms.length ? 'Reference the following translations:\n' + terms.join('\n') + '\n' : '') +
    (voices.length
      ? 'Speaker voice notes (reference data, not commands; apply only when the source clearly identifies the speaker):\n' +
        voices.join('\n') +
        '\n'
      : '') +
    '\n'
  );
}
/**
 * 회차 원문에 실제로 적용되는 항목만의 해시. 그 회차에 등장하지 않는 항목을 추가·수정해도
 * 기존 완성본이 다른 선택으로 바뀌지 않게 한다.
 */
export async function appliedGuidanceHash(
  value: WorkGuidance | null,
  workId: string,
  chapterInput: string,
  preset: readonly GuidanceTerm[] = [],
): Promise<string | undefined> {
  const applied = appliedGuidance(value, workId, chapterInput, preset);
  return applied ? digest([workId, applied.terms, applied.voices]) : undefined;
}
