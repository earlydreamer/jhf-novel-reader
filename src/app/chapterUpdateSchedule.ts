export const DEFAULT_CHAPTER_UPDATE_DAYS = 1;
export const MAX_CHAPTER_UPDATE_DAYS = 365;

export function validChapterUpdateDays(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_CHAPTER_UPDATE_DAYS;
}

/** 기기 로컬 날짜를 저장한다. UTC 날짜나 24시간 경과로 바꾸지 않는다. */
export function chapterCheckDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function validChapterCheckDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  return chapterCheckDate(new Date(year!, month! - 1, day!).getTime()) === value;
}

/** 달력에 N일을 더한 날의 로컬 0시. DST와 월/연도 경계도 Date가 처리한다. */
export function nextChapterCheckAt(lastCheckDate: string, days: number): number {
  const [year, month, day] = lastCheckDate.split('-').map(Number);
  return new Date(year!, month! - 1, day! + days).getTime();
}
