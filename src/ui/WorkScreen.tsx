import type { ChapterRef, WorkPage } from '../contracts/reading';
export interface WorkScreenProps { work: WorkPage; selectedChapterId?: string; busy: boolean; savedChapterIds: readonly string[]; onSelect(chapter: ChapterRef): void }
export function WorkScreen({ work, selectedChapterId, savedChapterIds, busy, onSelect }: WorkScreenProps) {
  return <section aria-label="작품 목차">
    <h1>{work.title}</h1>
    <a href={work.canonicalUrl} target="_blank" rel="noreferrer">작품 원문</a>
    <h2>목차</h2>
    <p>{work.complete ? '확인된 전체 목차' : '일부 목차입니다. 전체 목록은 아직 확인하지 않았습니다.'}</p>
    <ol>{work.chapters.map(chapter => <li key={chapter.chapterId} aria-current={chapter.chapterId === selectedChapterId ? 'true' : undefined}><button disabled={busy} onClick={() => onSelect(chapter)}>{chapter.title}</button>{savedChapterIds.includes(chapter.chapterId) && <span> 번역 저장됨</span>}{chapter.chapterId === selectedChapterId && <span> 선택한 회차</span>}</li>)}</ol>
    {work.nextPageUrl && <p>다음 목차 페이지가 있습니다. 여러 페이지 불러오기는 후속 단계에서 연결됩니다.</p>}
  </section>;
}
