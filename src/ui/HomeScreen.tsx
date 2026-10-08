import type { JSX } from 'react';
import type { LegacyMigrationWarning } from '../storage/migration';
import type { RenewalSnapshot } from '../app/renewalController';
import { Button } from './components/Button';
import { Card } from './components/Card';
import { Dialog } from './components/Modal';
import { Menu } from './components/Menu';
import { ListItem } from './components/ListItem';
import { ExtendedFab } from './components/ExtendedFab';
import brandLogo from './assets/brand-logo.png';
import './home.css';

export interface HomeScreenProps {
  state: RenewalSnapshot;
  urlDialogOpen: boolean;
  onCloseUrlDialog(): void;
  onOpen(url: string): void;
  onOpenLibraryWork(workId: string): void;
  onRequestRemove(workId: string, title: string): void;
  onBrowse(startUrl?: string): void;
  onContinue(versionId: string): void;
  onOpenPendingSave(): void;
  onOpenBatch(): void;
  legacyWarnings: readonly LegacyMigrationWarning[];
}

function dateRead(value: string): string {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return '오늘 읽음';
  return `${date.getMonth() + 1}월 ${date.getDate()}일 읽음`;
}

export function HomeScreen(props: HomeScreenProps): JSX.Element {
  const { state } = props;
  const [mostRecent] = state.recent;
  const recentWork = mostRecent
    ? state.libraryWorks.find((entry) => entry.work.workId === mostRecent.workId)?.work
    : undefined;
  const recentChapter = recentWork?.chapters.find(
    (chapter) => chapter.chapterId === mostRecent?.chapterId,
  );
  const pendingSave = state.pendingSaveChapter;
  return (
    <section className="nr-library" aria-label="서재">
      {pendingSave && (
        <aside className="nr-notice nr-notice--error" aria-label="저장 대기 중인 번역">
          <p>{pendingSave.title}의 번역 결과를 아직 저장하지 못했어요.</p>
          <Button variant="text" onClick={props.onOpenPendingSave}>
            저장 화면으로 가기
          </Button>
        </aside>
      )}
      {state.batch?.record && state.batch.record.phase !== 'complete' && (
        <aside className="nr-notice" aria-label="일괄 번역 상태">
          <p>{state.batch.record.work.title}의 일괄 번역을 이어서 확인할 수 있어요.</p>
          <Button variant="text" onClick={props.onOpenBatch}>
            일괄 번역 보기
          </Button>
        </aside>
      )}
      {props.legacyWarnings.length > 0 && (
        <details className="nr-notice" aria-label="이전 읽기 데이터 확인">
          <summary>이전 데이터 일부를 찾지 못했어요</summary>
          <ul>
            {props.legacyWarnings.map((warning) => (
              <li key={warning.cacheKey}>
                기록 {warning.cacheKey.slice(3, 15)}:{' '}
                {warning.reason === 'missing'
                  ? '저장 파일을 찾을 수 없어요.'
                  : warning.reason === 'unfinished'
                    ? '완료되지 않은 번역이에요.'
                    : '손상되었거나 지원하지 않는 형식이에요.'}
              </li>
            ))}
          </ul>
        </details>
      )}

      {recentWork && mostRecent && (
        <Card
          variant="tonal"
          onClick={() => props.onContinue(mostRecent.versionId)}
          label="이어서 읽기"
        >
          <span className="nr-library__continue-label">이어서 읽기</span>
          <strong>{state.recentTitles[recentWork.workId] ?? recentWork.title}</strong>
          <span>
            {recentChapter?.ordinal ?? mostRecent.chapterId.split('/').at(-1)}화 ·{' '}
            {recentChapter
              ? (state.recentTitles[recentChapter.chapterId] ?? recentChapter.title)
              : mostRecent.chapterId}
          </span>
        </Card>
      )}

      {state.libraryWorks.length === 0 ? (
        <div className="nr-library__empty">
          <img
            className="nr-library__brand"
            src={brandLogo}
            alt="JHF Novel Reader"
            width={160}
            height={160}
          />
          <h1>읽고 싶은 작품을 찾아보세요</h1>
          <p>나로우에서 작품을 고르면 서재에 담겨요.</p>
        </div>
      ) : (
        <section aria-label="작품 목록">
          <h1 className="nr-visually-hidden">서재</h1>
          <ul className="nr-library__list">
            {state.libraryWorks.map(({ work, savedChapterIds, recent }) => {
              const savedCount = new Set(savedChapterIds).size;
              const supporting =
                savedCount > 0
                  ? `${savedCount}화 저장 · ${recent ? dateRead(recent.updatedAt) : '아직 읽지 않았어요'}`
                  : '아직 번역하지 않았어요';
              return (
                <li key={work.workId}>
                  <ListItem
                    headline={state.recentTitles[work.workId] ?? work.title}
                    supporting={supporting}
                    onClick={() => props.onOpenLibraryWork(work.workId)}
                    trailing={
                      <Menu
                        label={`${state.recentTitles[work.workId] ?? work.title} 메뉴`}
                        items={[
                          {
                            label: '원문 사이트에서 보기',
                            onSelect: () => props.onBrowse(work.canonicalUrl),
                          },
                          {
                            label: '서재에서 제거하기',
                            tone: 'danger',
                            icon: 'delete',
                            onSelect: () =>
                              props.onRequestRemove(
                                work.workId,
                                state.recentTitles[work.workId] ?? work.title,
                              ),
                          },
                        ]}
                      />
                    }
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <Dialog
        open={props.urlDialogOpen}
        title="URL로 열기"
        onClose={props.onCloseUrlDialog}
        actions={null}
      >
        <UrlForm onClose={props.onCloseUrlDialog} onOpen={props.onOpen} />
      </Dialog>
      <ExtendedFab icon="search" label="작품 찾기" onClick={() => props.onBrowse()} />
    </section>
  );
}

function UrlForm({ onClose, onOpen }: { onClose(): void; onOpen(url: string): void }): JSX.Element {
  return (
    <form
      className="nr-library__url-form"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const url = String(data.get('url') ?? '').trim();
        onClose();
        onOpen(url);
      }}
    >
      <label>
        작품 또는 회차 URL
        <input name="url" type="url" required autoComplete="url" />
      </label>
      <div className="nr-dialog__actions">
        <Button variant="text" onClick={onClose}>
          닫기
        </Button>
        <Button variant="filled" type="submit">
          열기
        </Button>
      </div>
    </form>
  );
}
