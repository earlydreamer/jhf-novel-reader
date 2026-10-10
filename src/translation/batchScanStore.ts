import { storageError } from '../storage/errors';
import type { PrivateFiles } from '../storage/journal';
import { check, integer, object, text } from '../storage/validation';
import type { ScanChapter } from './termScan';

/** 범위 후보 스캔에서 받은 원문을 기기에 남겨, 중단된 스캔을 받은 회차부터 이어서 하게 한다. */
export interface BatchScanStore {
  read(recordId: string, index: number): Promise<ScanChapter | null>;
  write(recordId: string, index: number, chapter: ScanChapter): Promise<void>;
  clear(recordId: string, count: number): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 범위가 커도 파일 삭제 호출이 한꺼번에 몰리지 않도록 나눠서 지운다.
const CLEAR_CHUNK = 32;

function checkRecordId(recordId: string): void {
  check(typeof recordId === 'string' && UUID.test(recordId));
}

// 네이티브 어댑터는 최상위 디렉터리 아래 한 단계 파일명만 허용하므로 평면 파일로 둔다.
function chapterPath(recordId: string, index: number): string {
  checkRecordId(recordId);
  integer(index);
  return `batches/scan-${recordId}-${index}.json`;
}

/** 저장본과 쓰기 입력을 같은 규칙으로 검사하고, 저장에 필요한 필드만 남긴 새 값을 돌려준다. */
function validateChapter(value: unknown): ScanChapter {
  object(value, ['chapterId', 'paragraphs']);
  text(value.chapterId);
  check(Array.isArray(value.paragraphs));
  const paragraphs = (value.paragraphs as unknown[]).map((paragraph) => {
    object(paragraph, ['text', 'ruby']);
    check(typeof paragraph.text === 'string' && Array.isArray(paragraph.ruby));
    const body = paragraph.text;
    const ruby = (paragraph.ruby as unknown[]).map((item) => {
      object(item, ['start', 'end', 'reading']);
      integer(item.start);
      integer(item.end);
      check(item.start <= item.end && item.end <= body.length);
      check(typeof item.reading === 'string');
      return { start: item.start, end: item.end, reading: item.reading };
    });
    return { text: body, ruby };
  });
  return { chapterId: value.chapterId, paragraphs };
}

async function removeQuietly(files: PrivateFiles, path: string): Promise<void> {
  try {
    await files.remove?.(path);
  } catch {
    // 이미 없는 파일이나 정리 실패는 무시한다. 남은 파일은 다음 스캔에서 chapterId로 걸러진다.
  }
}

export function createBatchScanStore(files: PrivateFiles): BatchScanStore {
  return {
    async read(recordId, index) {
      const raw = await files.read(chapterPath(recordId, index));
      if (raw === null) return null;
      try {
        return validateChapter(JSON.parse(raw));
      } catch {
        // 깨진 저장본은 없는 것으로 보고 그 회차를 다시 받는다.
        return null;
      }
    },
    async write(recordId, index, chapter) {
      const path = chapterPath(recordId, index);
      const value = validateChapter(chapter);
      try {
        await files.write(path, JSON.stringify(value));
      } catch (error) {
        throw storageError(error);
      }
    },
    async clear(recordId, count) {
      checkRecordId(recordId);
      integer(count);
      if (!files.remove) return;
      for (let start = 0; start < count; start += CLEAR_CHUNK) {
        const end = Math.min(start + CLEAR_CHUNK, count);
        const paths = Array.from({ length: end - start }, (_, offset) =>
          chapterPath(recordId, start + offset),
        );
        await Promise.all(paths.map((path) => removeQuietly(files, path)));
      }
    },
  };
}
