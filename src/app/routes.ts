export type Route =
  | { kind: 'home' }
  | { kind: 'work'; workId: string; selectedChapterId?: string }
  | { kind: 'translation'; chapterId: string }
  | { kind: 'reader'; versionId: string }
  | { kind: 'settings' };
