import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type MouseEvent,
  type PointerEvent,
  type UIEvent,
} from 'react';
import type {
  ChapterRef,
  CompletedTranslation,
  ReadingPosition,
  TranslationState,
  WorkPage,
} from '../contracts/reading';
import type { ErrorCode } from '../contracts';
import type { CatalogStatus, SourceChangeStatus } from '../app/renewalController';
import { japaneseBlockIndexes } from '../translation/quality';
import { displayedTitle, type SavedTitle } from '../translation/titles';
import { BottomSheet, Dialog } from './components/Modal';
import { Button } from './components/Button';
import { FloatingToolbar } from './components/FloatingToolbar';
import { IconButton } from './components/IconButton';
import { LinearProgress } from './components/LinearProgress';
import { Menu } from './components/Menu';
import { StatusPill } from './components/StatusPill';
import { useSnackbar, useSnackbarOffset } from './components/Snackbar';
import { TopAppBar } from './components/TopAppBar';
import { useBackHandler } from './shell/backStack';
import './immersive-reader.css';

type RouteKind = 'translation' | 'reader';
type ReadingBackground = 'theme' | 'sepia' | 'black';
type LineHeight = 1.6 | 1.8 | 2;

export interface ImmersiveReaderProps {
  route: RouteKind;
  chapter: ChapterRef;
  work: WorkPage | null;
  version: CompletedTranslation | null;
  position: ReadingPosition | null;
  translation: TranslationState;
  translationActive: boolean;
  paragraphRepair: boolean;
  translationAvailable: boolean;
  selectedModelId: string | null;
  connected: boolean;
  catalogStatus: CatalogStatus;
  connectionConfigured: boolean;
  fontSize: number;
  readingBackground: ReadingBackground;
  lineHeight: LineHeight;
  showOriginal: boolean;
  sourceChange: SourceChangeStatus;
  busy: boolean;
  retryParagraphsAvailable: boolean;
  pendingSaveElsewhere?: boolean;
  titles?: { entries: readonly SavedTitle[]; busy: boolean };
  onBack(): void;
  onShowOriginal(value: boolean): void;
  onFontSize(value: number): void;
  onReadingBackground(value: ReadingBackground): void;
  onLineHeight(value: LineHeight): void;
  onPreviewPosition(index: number, offset: number): void;
  onPosition(blockId: string, offset: number): void;
  onAdjacent(direction: -1 | 1): void;
  onTranslate(): void;
  onCancel(): void;
  onRetry(): void;
  onRetrySave(): void;
  onRetryParagraphs?(indexes: readonly number[]): void;
  onSettings(): void;
  onCheckConnection(): void;
  onRefreshSource(): void;
  onOpenSaved(): void;
  onRetryTitle?(): void;
  onSaveTitle?(title: string): Promise<void>;
  onGoHome(): void;
  onDisplayed?(versionId: string): void;
}

type ParagraphAnchor = { index: number; offset: number };
const LONG_PRESS_MS = 500;
const CENTER_TAP = 0.2;
const translationFailureMessages: Partial<Record<ErrorCode, string>> = {
  auth: '서버 인증에 실패했어요. 연결 설정에서 인증 정보를 확인해 주세요.',
  connection: '서버에 연결하지 못했어요. 주소와 서버 상태를 확인해 주세요.',
  source_access: '선택한 회차에 접근하지 못했어요. 원문 주소와 접근 상태를 다시 확인해 주세요.',
  source_parse: '선택한 회차의 본문을 읽지 못했어요. 원문 페이지가 바뀌었는지 확인해 주세요.',
  input_limit:
    '선택한 모델의 입력 한도를 넘었어요. 용어집·말투 항목을 줄이거나 다른 모델을 선택해 주세요.',
  output_limit: '응답이 출력 길이 제한에 도달해 완성본으로 저장하지 않았어요.',
  blocked: '제공자가 응답을 차단했어요. 다른 제공자를 선택하거나 요청 내용을 확인해 주세요.',
  invalid_output: '완료된 번역 응답을 확인하지 못했어요. 명시적으로 다시 요청할 수 있어요.',
  guidance_unsupported:
    '현재 모델은 용어집·말투 적용을 지원하지 않아요. 로컬 번역 설정을 확인해 주세요.',
  model_missing: '생성 모델을 찾지 못했어요. 연결 설정에서 모델을 다시 선택해 주세요.',
  storage: '기기 저장소에 접근하지 못했어요. 저장 공간이나 앱 상태를 확인해 주세요.',
};

function ownVersion(version: CompletedTranslation | null, chapter: ChapterRef): boolean {
  return Boolean(
    version &&
    version.source.workId === chapter.workId &&
    version.source.chapterId === chapter.chapterId,
  );
}

export function ImmersiveReader(props: ImmersiveReaderProps): JSX.Element {
  const { chapter } = props;
  const route = props.route;
  const onDisplayed = props.onDisplayed;
  const version = ownVersion(props.version, chapter) ? props.version : null;
  const body = useRef<HTMLElement>(null);
  const topBar = useRef<HTMLDivElement>(null);
  const previousScrollTop = useRef(0);
  const lastMode = useRef(props.showOriginal);
  const translationAnchor = useRef<ParagraphAnchor | null>(null);
  const originalAnchor = useRef(0);
  const pendingOriginalIndex = useRef<number | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerOrigin = useRef<{ x: number; y: number } | null>(null);
  const swallowClick = useRef(false);
  const shownVersionId = useRef<string | null>(null);
  const trackedVersionId = useRef<string | null>(null);
  const announcedSavedVersion = useRef<string | null>(null);
  const showSnackbar = useSnackbar();
  const [barsVisible, setBarsVisible] = useState(false);
  // 하단 툴바가 보이면 스낵바를 그 위로 올린다(#154).
  useSnackbarOffset(barsVisible ? 72 : 0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [paragraphSheet, setParagraphSheet] = useState<number | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedParagraphs, setSelectedParagraphs] = useState<number[]>([]);
  const [titleEditorOpen, setTitleEditorOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [titleSaving, setTitleSaving] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [dismissedActionKey, setDismissedActionKey] = useState<string | null>(null);
  const translatedTitle = displayedTitle(
    props.titles?.entries ?? [],
    chapter.chapterId,
    version?.source.title ?? chapter.title,
  );
  const title = props.showOriginal ? (version?.source.title ?? chapter.title) : translatedTitle;
  const preview = props.translation.preview;
  const pendingSave = props.translation.pendingSave;
  const ownsPendingSave = Boolean(
    props.route === 'translation' &&
    pendingSave?.source.workId === chapter.workId &&
    pendingSave.source.chapterId === chapter.chapterId &&
    props.translation.token?.chapterId === chapter.chapterId &&
    (!pendingSave.provenance.repair ||
      !version ||
      pendingSave.provenance.repair.baseVersionId === version?.versionId),
  );
  const ownsLivePreview =
    props.route === 'translation' &&
    (!pendingSave || ownsPendingSave) &&
    (props.translationActive || ['failed', 'unknown'].includes(props.translation.phase)) &&
    props.translation.token?.chapterId === chapter.chapterId;
  const livePreview = ownsPendingSave
    ? pendingSave?.text
    : ownsLivePreview && typeof preview === 'string'
      ? preview
      : undefined;
  const displayVersion = ownsPendingSave
    ? pendingSave
    : ownsLivePreview && typeof preview === 'string'
      ? null
      : version;
  const paragraphs =
    props.showOriginal && version
      ? version.source.paragraphs.map((paragraph) => paragraph.text)
      : livePreview !== undefined
        ? livePreview.split('\n\n')
        : version
          ? version.blocks.map((block) => block.text)
          : [];
  const originalAvailable = Boolean(version?.source.chapterId === chapter.chapterId);
  const chapterIndex =
    props.work?.chapters.findIndex(
      (value) => value.chapterId === chapter.chapterId && value.workId === chapter.workId,
    ) ?? -1;
  const previousAvailable = chapterIndex > 0;
  const nextAvailable =
    !!props.work && chapterIndex >= 0 && chapterIndex < props.work.chapters.length - 1;
  const active = props.translationActive;
  const failed = displayVersion?.failedParagraphs ?? [];
  const heuristic =
    displayVersion?.quality?.japaneseBlocks ?? japaneseBlockIndexes(displayVersion?.blocks ?? []);
  const missingTerms = displayVersion?.quality?.missingTerms ?? [];
  // 안내할 내용이 있을 때만 품질 안내 카드를 그린다. 둘 다 없으면 빈 카드가 보인다.
  const showFailedNote = failed.length > 0;
  const showHeuristicNote = heuristic.some((index) => !failed.includes(index));
  const oneToOneParagraphs = Boolean(
    version && version.blocks.length === version.source.paragraphs.length,
  );
  const mayRepair = Boolean(
    props.onRetryParagraphs &&
    props.retryParagraphsAvailable &&
    version &&
    oneToOneParagraphs &&
    !props.translation.pendingSave &&
    !props.translationActive,
  );

  const overlayOpen =
    menuOpen ||
    settingsOpen ||
    qualityOpen ||
    infoOpen ||
    paragraphSheet !== null ||
    titleEditorOpen;
  useBackHandler(barsVisible && !overlayOpen, () => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && topBar.current?.contains(focused)) body.current?.focus();
    setBarsVisible(false);
  });

  useLayoutEffect(() => {
    const element = body.current;
    if (!element) return;
    if (lastMode.current !== props.showOriginal) {
      lastMode.current = props.showOriginal;
      if (props.showOriginal) {
        const pendingIndex = pendingOriginalIndex.current;
        const target =
          pendingIndex === null
            ? null
            : element.querySelector<HTMLElement>(`[data-reader-index="${pendingIndex}"]`);
        element.scrollTop = target ? target.offsetTop : originalAnchor.current;
        if (target) originalAnchor.current = element.scrollTop;
        pendingOriginalIndex.current = null;
      } else {
        element.scrollTop = translatedScrollPosition(element, translationAnchor.current);
      }
      previousScrollTop.current = element.scrollTop;
    }
  }, [props.showOriginal, version]);

  useLayoutEffect(() => {
    if (!version) return;
    const priorVersion = trackedVersionId.current;
    if (priorVersion && priorVersion !== version.versionId) {
      translationAnchor.current = null;
      originalAnchor.current = 0;
      pendingOriginalIndex.current = null;
      shownVersionId.current = null;
      if (body.current) body.current.scrollTop = 0;
      previousScrollTop.current = 0;
    }
    trackedVersionId.current = version.versionId;
    if (
      !props.position ||
      props.position.versionId !== version.versionId ||
      props.position.workId !== version.source.workId ||
      props.position.chapterId !== version.source.chapterId ||
      shownVersionId.current === version.versionId
    )
      return;
    shownVersionId.current = version.versionId;
    const index = version.blocks.findIndex((block) => block.id === props.position?.blockId);
    if (index >= 0) {
      translationAnchor.current = { index, offset: props.position.offset };
      if (!props.showOriginal && body.current) {
        body.current.scrollTop = translatedScrollPosition(body.current, translationAnchor.current);
        previousScrollTop.current = body.current.scrollTop;
      }
    }
  }, [version, props.position, props.showOriginal]);

  useEffect(() => {
    if (route === 'reader' && version) onDisplayed?.(version.versionId);
  }, [route, version, onDisplayed]);

  useEffect(() => {
    if (props.route !== 'translation' || !version || props.translation.phase !== 'ready') return;
    if (announcedSavedVersion.current === version.versionId) return;
    announcedSavedVersion.current = version.versionId;
    showSnackbar('번역을 저장했어요. 저장된 번역을 읽고 있어요.');
  }, [props.route, props.translation.phase, version, showSnackbar]);

  useEffect(
    () => () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    },
    [],
  );

  const rememberTranslationPosition = useCallback(() => {
    const element = body.current;
    if (!element) return;
    const rows = [...element.querySelectorAll<HTMLElement>('[data-reader-index]')];
    const row = [...rows].reverse().find((item) => item.offsetTop <= element.scrollTop) ?? rows[0];
    if (!row) return;
    const index = Number(row.dataset.readerIndex);
    const offset = Math.max(0, element.scrollTop - row.offsetTop);
    translationAnchor.current = { index, offset };
    if (!version) props.onPreviewPosition(index, offset);
    else if (props.route === 'translation') props.onPreviewPosition(index, offset);
    else {
      const block = version.blocks[index];
      if (block) props.onPosition(block.id, offset);
    }
  }, [props, version]);

  function toggleOriginal(): void {
    if (!originalAvailable) return;
    props.onShowOriginal(!props.showOriginal);
  }

  function openTitleEditor(): void {
    setTitleDraft(translatedTitle);
    setTitleError(null);
    setTitleEditorOpen(true);
  }

  async function saveTitle(): Promise<void> {
    if (!props.onSaveTitle || !titleDraft.trim() || titleSaving) return;
    setTitleSaving(true);
    setTitleError(null);
    try {
      await props.onSaveTitle(titleDraft.trim());
      setTitleEditorOpen(false);
    } catch {
      setTitleError('제목을 저장하지 못했어요. 입력한 내용은 그대로 남아 있어요.');
    } finally {
      setTitleSaving(false);
    }
  }

  function toggleParagraph(index: number): void {
    setSelectedParagraphs((current) =>
      current.includes(index) ? current.filter((item) => item !== index) : [...current, index],
    );
  }

  function startLongPress(event: PointerEvent<HTMLElement>, index: number): void {
    if (selectionMode || (event.target as HTMLElement).closest('button,a,input,select,textarea'))
      return;
    pointerOrigin.current = { x: event.clientX, y: event.clientY };
    longPressTimer.current = setTimeout(() => {
      swallowClick.current = true;
      setParagraphSheet(index);
    }, LONG_PRESS_MS);
  }

  function cancelLongPress(): void {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
    pointerOrigin.current = null;
  }

  function moveLongPress(event: PointerEvent<HTMLElement>): void {
    const origin = pointerOrigin.current;
    if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10)
      cancelLongPress();
  }

  function articleClick(event: MouseEvent<HTMLElement>): void {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    if (selectionMode || (event.target as HTMLElement).closest('button,a')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width ? (event.clientX - rect.left) / rect.width : 0;
    if (ratio >= CENTER_TAP && ratio <= 1 - CENTER_TAP) setBarsVisible((visible) => !visible);
  }

  function scrollArticle(event: UIEvent<HTMLElement>): void {
    const element = event.currentTarget;
    const current = element.scrollTop;
    if (props.showOriginal) originalAnchor.current = current;
    else rememberTranslationPosition();
    if (current > previousScrollTop.current + 8) setBarsVisible(false);
    else if (current < previousScrollTop.current - 8) setBarsVisible(true);
    previousScrollTop.current = current;
  }

  const menuItems = [
    ...(displayVersion
      ? [
          { label: '번역 확인 결과 보기', onSelect: () => setQualityOpen(true) },
          ...(mayRepair
            ? [
                {
                  label: '문단 골라 다시 번역하기',
                  onSelect: () => {
                    setSelectionMode(true);
                    setBarsVisible(true);
                    body.current?.focus();
                  },
                },
                ...(failed.length
                  ? [
                      {
                        label: '실패한 문단 다시 번역하기',
                        onSelect: () => props.onRetryParagraphs?.(failed),
                      },
                    ]
                  : []),
              ]
            : []),
          ...(props.onRetryTitle
            ? [{ label: '제목 다시 번역하기', onSelect: props.onRetryTitle }]
            : []),
          ...(props.onSaveTitle
            ? [{ label: '제목 직접 수정하기', onSelect: openTitleEditor }]
            : []),
          {
            label: '원문 사이트에서 보기',
            onSelect: () =>
              window.open(displayVersion.source.canonicalUrl, '_blank', 'noopener,noreferrer'),
          },
          { label: '번역 정보 보기', onSelect: () => setInfoOpen(true) },
        ]
      : [
          { label: '제목 다시 번역하기', onSelect: props.onRetryTitle ?? (() => {}) },
          ...(props.onSaveTitle
            ? [{ label: '제목 직접 수정하기', onSelect: openTitleEditor }]
            : []),
          {
            label: '원문 사이트에서 보기',
            onSelect: () => window.open(chapter.canonicalUrl, '_blank', 'noopener,noreferrer'),
          },
        ]),
    { label: '서재로 가기', onSelect: props.onGoHome },
  ];

  const phaseLabel = {
    idle: '번역 전',
    preparing: '원문 준비 중',
    translating: '모델 응답 대기 중',
    validating: '결과를 확인하고 있어요',
    saving: '기기에 저장 중',
    ready: '저장 완료',
    failed: '번역 실패',
    unknown: '요청 결과 확인 필요',
  }[props.translation.phase];
  const progress = props.translation.progress;
  const activeFlow = ['preparing', 'translating', 'validating', 'saving'].includes(
    props.translation.phase,
  );
  const failureCode = props.translation.error?.code;
  const failureMessage = failureCode ? translationFailureMessages[failureCode] : undefined;
  const failureNeedsSettings = [
    'auth',
    'connection',
    'input_limit',
    'guidance_unsupported',
    'model_missing',
  ].includes(failureCode ?? '');
  const failureNeedsSourceRefresh =
    failureCode === 'source_access' || failureCode === 'source_parse';
  const canStartTranslation =
    props.connected &&
    props.translationAvailable &&
    !!props.selectedModelId &&
    !props.pendingSaveElsewhere &&
    !active &&
    props.translation.phase === 'idle';
  const catalogUnavailable = props.catalogStatus !== 'connected';
  const catalogMessage: Partial<Record<CatalogStatus, string>> = {
    auth: '서버 인증을 확인할 수 없어요. 연결 설정에서 인증 정보를 확인해 주세요.',
    storage: '저장된 연결을 읽지 못했어요. 설정을 확인해 주세요.',
    connection: '서버 연결이 확인되지 않았어요. 서버 주소와 상태를 확인해 주세요.',
    model_list: '서버의 모델 목록을 확인하지 못했어요. 다시 확인해 주세요.',
    empty: '사용할 수 있는 모델이 없어요. 서버에서 모델을 확인해 주세요.',
    unavailable: '서버 연결을 확인할 수 없어요. 연결 설정을 확인해 주세요.',
  };

  // 안내 카드는 본문 흐름 안(article 첫 자식)의 컨테이너에 모아 상태바·화면 가장자리에 붙지 않게 한다.
  const notices = [
    props.sourceChange === 'checking' && (
      <p key="source-checking" className="nr-reader-note" role="status">
        원문 변경을 확인하고 있어요.
      </p>
    ),
    props.sourceChange === 'unavailable' && (
      <p key="source-unavailable" className="nr-reader-note" role="status">
        원문 변경을 확인하지 못했어요.
      </p>
    ),
    props.busy && (
      <p key="busy" className="nr-reader-note" role="status">
        회차를 불러오고 있어요.
      </p>
    ),
    props.route === 'translation' && props.catalogStatus === 'checking' && (
      <p key="catalog-checking" className="nr-reader-note" role="status">
        저장된 연결의 서버와 모델 목록을 확인하고 있어요.
      </p>
    ),
    props.route === 'translation' && catalogUnavailable && props.catalogStatus !== 'checking' && (
      <p key="catalog-unavailable" className="nr-reader-note" role="status">
        {catalogMessage[props.catalogStatus] ?? '연결 상태를 확인해 주세요.'}
      </p>
    ),
    props.route === 'translation' && props.connectionConfigured && catalogUnavailable && (
      <Button
        key="check-connection"
        variant="outlined"
        disabled={props.catalogStatus === 'checking' || props.busy}
        onClick={props.onCheckConnection}
      >
        연결 다시 확인
      </Button>
    ),
    props.route === 'translation' && !props.selectedModelId && !catalogUnavailable && (
      <p key="model-missing" className="nr-reader-note" role="status">
        생성 모델이 선택되지 않았어요. 연결 설정에서 모델을 선택해 주세요.
      </p>
    ),
    props.route === 'translation' && props.translation.phase === 'idle' && !active && (
      <div key="translate-start" className="nr-reader-notice">
        <p>
          {props.connected && props.translationAvailable
            ? '이 회차를 번역하면 여기서 읽을 수 있어요.'
            : '번역 서버를 연결하면 바로 읽을 수 있어요.'}
        </p>
        <Button
          variant="filled"
          size="m"
          disabled={!canStartTranslation}
          onClick={props.onTranslate}
        >
          이 화 번역하기
        </Button>
        {(!props.connected || !props.translationAvailable) && (
          <Button variant="tonal" onClick={props.onSettings}>
            연결 설정
          </Button>
        )}
      </div>
    ),
    props.route === 'translation' && activeFlow && !paragraphs.length && (
      <p key="translating-note" className="nr-reader-note">
        다음 문단을 번역하고 있어요…
      </p>
    ),
  ];
  // 버튼이 있는 행동 안내는 본문 흐름 밖의 떠 있는 카드로 띄운다(#150). 같은 상태에서 닫으면 상태가 바뀔 때까지 다시 나오지 않는다.
  const actionNotices = [
    props.sourceChange === 'changed' && (
      <div
        key="source-changed"
        className="nr-reader-notice nr-reader-notice--warning"
        role="status"
      >
        <span>원문이 바뀌었어요.</span>
        <Button variant="text" onClick={props.onRefreshSource}>
          새 원문으로 번역하기
        </Button>
      </div>
    ),
    props.route === 'translation' && props.translation.phase === 'unknown' && (
      <div key="unknown-result" className="nr-reader-notice nr-reader-notice--warning" role="alert">
        <p>요청이 이미 처리됐을 수 있어 자동으로 다시 보내지 않아요.</p>
        <Button
          variant="outlined"
          disabled={active || !props.connected || !props.selectedModelId}
          onClick={props.onRetry}
        >
          확인하고 다시 번역하기
        </Button>
      </div>
    ),
    props.route === 'translation' && props.translation.phase === 'failed' && (
      <div
        key="translation-failed"
        className="nr-reader-notice nr-reader-notice--error"
        role="alert"
      >
        <p>
          {props.translation.pendingSave
            ? '번역 결과를 저장하지 못했어요.'
            : (failureMessage ?? '번역을 완료하지 못했어요. 자동으로 다시 요청하지 않아요.')}
        </p>
        {props.translation.pendingSave ? (
          <Button variant="outlined" disabled={active} onClick={props.onRetrySave}>
            저장 다시 하기
          </Button>
        ) : failureNeedsSettings ? (
          <Button variant="outlined" onClick={props.onSettings}>
            연결 설정 열기
          </Button>
        ) : failureNeedsSourceRefresh ? (
          <Button variant="outlined" onClick={props.onRetry}>
            원문 다시 확인하고 번역하기
          </Button>
        ) : (
          <Button
            variant="outlined"
            disabled={active || !props.connected || !props.selectedModelId}
            onClick={props.onRetry}
          >
            중복 여부를 확인하고 다시 번역하기
          </Button>
        )}
      </div>
    ),
    props.route === 'translation' && props.translation.phase === 'ready' && !version && (
      <div key="ready-saved" className="nr-reader-notice">
        <p>번역을 저장했어요.</p>
        <Button variant="filled" size="m" onClick={props.onOpenSaved}>
          저장된 번역 열기
        </Button>
      </div>
    ),
  ];
  const hasNotices = notices.some(Boolean);
  const actionKey = `${chapter.chapterId}:${actionNotices
    .flatMap((notice) => (notice ? [notice.key] : []))
    .join('|')}`;
  const actionVisible = actionNotices.some(Boolean) && actionKey !== dismissedActionKey;

  return (
    <section
      aria-label="몰입형 리더"
      className="nr-immersive-reader"
      data-reading-background={props.readingBackground}
      style={
        {
          '--nr-reading-font-rem': props.fontSize / 16,
          '--nr-reading-line-height': props.lineHeight,
        } as CSSProperties
      }
    >
      <div
        ref={topBar}
        aria-hidden={!barsVisible || undefined}
        inert={!barsVisible}
        className={`nr-immersive-appbar${barsVisible ? '' : ' nr-immersive-appbar--hidden'}`}
      >
        <TopAppBar
          title={title}
          titleAs="span"
          navigation={
            <IconButton icon="arrow_back" label="목차로 돌아가기" onClick={props.onBack} />
          }
          actions={
            <>
              <button
                type="button"
                className="nr-reader-symbol-button"
                aria-label={props.showOriginal ? '번역 보기' : '원문 보기'}
                aria-pressed={props.showOriginal}
                disabled={!originalAvailable}
                onClick={toggleOriginal}
              >
                文
              </button>
              <Menu label="더보기" items={menuItems} onOpenChange={setMenuOpen} />
            </>
          }
        />
      </div>
      {activeFlow && (
        <LinearProgress
          label={phaseLabel}
          value={progress?.total ? progress.completed / progress.total : undefined}
        />
      )}
      {activeFlow && (
        <StatusPill action={{ label: '중단', onClick: props.onCancel }}>
          {phaseLabel}
          {props.translation.phase === 'translating' && progress
            ? ` · ${progress.completed}/${progress.total}묶음`
            : ''}
        </StatusPill>
      )}
      {actionVisible && (
        <div
          className={`nr-reader-float${activeFlow ? ' nr-reader-float--above-pill' : ''}`}
          role="region"
          aria-label="번역 안내"
        >
          {actionNotices}
          <IconButton
            icon="close"
            label="안내 닫기"
            onClick={() => setDismissedActionKey(actionKey)}
          />
        </div>
      )}
      <article
        ref={body}
        tabIndex={-1}
        aria-label={props.showOriginal ? '원문 본문' : version ? '번역 본문' : '번역 미리보기'}
        className="nr-immersive-article"
        lang={props.showOriginal ? 'ja' : 'ko'}
        onScroll={scrollArticle}
        onClick={articleClick}
        onPointerDown={(event) => {
          const row = (event.target as HTMLElement).closest<HTMLElement>('[data-reader-index]');
          if (row) startLongPress(event, Number(row.dataset.readerIndex));
        }}
        onPointerMove={moveLongPress}
        onPointerUp={cancelLongPress}
        onPointerCancel={() => {
          cancelLongPress();
          swallowClick.current = false;
        }}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          const row = (event.target as HTMLElement).closest<HTMLElement>('[data-reader-index]');
          if (selectionMode && row && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            toggleParagraph(Number(row.dataset.readerIndex));
          }
        }}
      >
        {hasNotices && <div className="nr-reader-notices">{notices}</div>}
        <header className="nr-reader-heading">
          <span className="nr-reader-ordinal">{chapter.ordinal}화</span>
          <h1>{title}</h1>
          <button
            type="button"
            className="nr-reader-reveal"
            onFocus={() => setBarsVisible(true)}
            onClick={() => {
              setBarsVisible(true);
              topBar.current?.querySelector<HTMLElement>('button')?.focus();
            }}
          >
            읽기 메뉴 열기
          </button>
          {!props.showOriginal && translatedTitle !== (version?.source.title ?? chapter.title) && (
            <p lang="ja" className="nr-reader-original-title">
              {version?.source.title ?? chapter.title}
            </p>
          )}
        </header>
        {props.translation.phase === 'translating' &&
          livePreview !== undefined &&
          paragraphs.length > 0 && (
            <p className="nr-reader-caption">저장 전 미리보기 · 도착한 문단부터 읽을 수 있어요.</p>
          )}
        {selectionMode && (
          <div className="nr-reader-selection" role="group" aria-label="문단 선택 재번역">
            <span>{selectedParagraphs.length}개 문단 선택</span>
            <Button
              variant="filled"
              disabled={!selectedParagraphs.length || !mayRepair}
              onClick={() => {
                props.onRetryParagraphs?.([...selectedParagraphs].sort((a, b) => a - b));
                setSelectionMode(false);
                setSelectedParagraphs([]);
              }}
            >
              선택 문단 다시 번역하기
            </Button>
            <Button
              variant="text"
              onClick={() => {
                setSelectionMode(false);
                setSelectedParagraphs([]);
              }}
            >
              취소
            </Button>
          </div>
        )}
        {paragraphs.length ? (
          paragraphs.map((text, index) => {
            const isFailed = !props.showOriginal && failed.includes(index);
            const selected = selectedParagraphs.includes(index);
            return (
              <p
                key={index}
                data-reader-index={index}
                data-preview-index={props.route === 'translation' ? index : undefined}
                data-block-id={version?.blocks[index]?.id}
                className={`nr-reader-paragraph${isFailed ? ' nr-reader-paragraph--failed' : ''}${selected ? ' nr-reader-paragraph--selected' : ''}${!text.trim() && !isFailed ? ' nr-reader-blank' : ''}`}
                role={selectionMode ? 'button' : undefined}
                tabIndex={selectionMode ? 0 : undefined}
                aria-pressed={selectionMode ? selected : undefined}
                onClick={() => {
                  if (selectionMode) toggleParagraph(index);
                }}
              >
                {isFailed && (
                  <span className="nr-reader-failed-label">번역하지 못해 원문으로 남겼어요.</span>
                )}
                {text || '\u00a0'}
                {isFailed && mayRepair && (
                  <Button
                    variant="text"
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onRetryParagraphs?.([index]);
                    }}
                  >
                    실패한 문단 다시 번역하기
                  </Button>
                )}
                {!props.showOriginal && !isFailed && heuristic.includes(index) && (
                  <span className="nr-reader-heuristic">일본어가 남아 있는지 확인해 주세요.</span>
                )}
              </p>
            );
          })
        ) : props.route === 'translation' ? (
          <p className="nr-reader-empty">
            {activeFlow
              ? '첫 문단이 도착하면 여기서 바로 읽을 수 있어요.'
              : '번역을 시작하면 이 화면에서 읽을 수 있어요.'}
          </p>
        ) : (
          <p className="nr-reader-empty">저장된 번역을 찾지 못했어요.</p>
        )}
        {displayVersion && !props.showOriginal && (showFailedNote || showHeuristicNote) && (
          <div className="nr-reader-quality-note">
            {showFailedNote && (
              <p role="status">번역에 실패한 {failed.length}개 문단을 원문으로 남겼어요.</p>
            )}
            {showHeuristicNote && (
              <p role="status">일본어가 남은 문단은 번역 확인 결과에서 살펴봐 주세요.</p>
            )}
          </div>
        )}
        {version && !oneToOneParagraphs && (
          <p className="nr-reader-note" role="note">
            원문과 번역 문단 수가 달라 문단별 원문 대응·재번역은 제공하지 않아요. 원문 전체는
            앱바에서 전환할 수 있어요.
          </p>
        )}
        {version &&
          !props.showOriginal &&
          chapterIndex >= 0 &&
          (nextAvailable || props.work?.complete) && (
            <div className="nr-reader-end" role="status">
              <p>{chapter.ordinal}화를 다 읽었어요.</p>
              {nextAvailable ? (
                <Button variant="filled" disabled={props.busy} onClick={() => props.onAdjacent(1)}>
                  {props.work!.chapters[chapterIndex + 1]!.ordinal}화 읽기
                </Button>
              ) : (
                <p>마지막 화까지 읽었어요.</p>
              )}
            </div>
          )}
      </article>
      <FloatingToolbar label="읽기 도구" hidden={!barsVisible} className="nr-reader-toolbar">
        <button
          type="button"
          className="nr-reader-symbol-button"
          aria-label="이전 화"
          disabled={!previousAvailable || props.busy}
          onClick={() => props.onAdjacent(-1)}
        >
          이전 화
        </button>
        <div className="nr-reader-toolbar__center">
          <button
            type="button"
            className="nr-reader-symbol-button"
            aria-label="목차"
            onClick={props.onBack}
          >
            목차
          </button>
          <button
            type="button"
            className="nr-reader-symbol-button"
            aria-label="보기 설정"
            onClick={() => setSettingsOpen(true)}
          >
            Aa
          </button>
        </div>
        <button
          type="button"
          className="nr-reader-symbol-button"
          aria-label="다음 화"
          disabled={!nextAvailable || props.busy}
          onClick={() => props.onAdjacent(1)}
        >
          다음 화
        </button>
      </FloatingToolbar>
      <BottomSheet open={settingsOpen} title="보기 설정" onClose={() => setSettingsOpen(false)}>
        <div className="nr-reader-sheet-body">
          <fieldset>
            <legend>독서 배경</legend>
            {(['theme', 'sepia', 'black'] as const).map((value) => (
              <Button
                key={value}
                variant={props.readingBackground === value ? 'tonal' : 'outlined'}
                aria-pressed={props.readingBackground === value}
                onClick={() => props.onReadingBackground(value)}
              >
                {value === 'theme' ? '기본' : value === 'sepia' ? '세피아' : '검정'}
              </Button>
            ))}
          </fieldset>
          <div className="nr-reader-font-control">
            <span>글자 크기</span>
            <button
              type="button"
              className="nr-reader-symbol-button"
              aria-label="글자 크기 줄이기"
              disabled={props.fontSize <= 10}
              onClick={() => props.onFontSize(Math.max(10, props.fontSize - 2))}
            >
              −
            </button>
            <output aria-live="polite">{props.fontSize}px</output>
            <button
              type="button"
              className="nr-reader-symbol-button"
              aria-label="글자 크기 키우기"
              disabled={props.fontSize >= 48}
              onClick={() => props.onFontSize(Math.min(48, props.fontSize + 2))}
            >
              +
            </button>
          </div>
          <fieldset>
            <legend>줄 간격</legend>
            {([1.6, 1.8, 2] as const).map((value) => (
              <Button
                key={value}
                variant={props.lineHeight === value ? 'tonal' : 'outlined'}
                aria-pressed={props.lineHeight === value}
                onClick={() => props.onLineHeight(value)}
              >
                {value}
              </Button>
            ))}
          </fieldset>
        </div>
      </BottomSheet>
      <BottomSheet open={qualityOpen} title="번역 확인 결과" onClose={() => setQualityOpen(false)}>
        <div className="nr-reader-sheet-body">
          <p>
            {ownsPendingSave ? '저장 대기 결과 · ' : ''}
            가나가 남은 문단 {heuristic.length}개 ·{' '}
            {displayVersion?.quality
              ? `확정 표기 미발견 ${missingTerms.length}개`
              : '용어 확인 기록 없음'}
          </p>
          <p>
            가나 잔존과 확정 표기의 전체 부재만 확인해요. 한자만 남은 일본어, 일부 등장분의 다른
            표기, 의미·말투는 원문과 직접 비교해 주세요. 번역 본문은 자동으로 고치거나 다시 요청하지
            않아요.
          </p>
          {ownsPendingSave && <p>이 결과는 아직 기기에 저장되지 않았어요.</p>}
          {!displayVersion?.quality && (
            <p>
              {ownsPendingSave ? '이 저장 대기 결과는' : '이 저장본은'} 용어 확인 기록이 없어 가나
              잔존만 확인했어요.
            </p>
          )}
          {displayVersion?.quality && !heuristic.length && !missingTerms.length && (
            <p>이 확인 규칙에서 발견한 항목이 없어요. 번역 품질의 합격 판정은 아니에요.</p>
          )}
          {heuristic.map((index) => (
            <Button
              key={index}
              variant="text"
              onClick={() => {
                setQualityOpen(false);
                body.current
                  ?.querySelector<HTMLElement>(`[data-reader-index="${index}"]`)
                  ?.scrollIntoView({ block: 'start' });
              }}
            >
              {index + 1}번째 문단 보기
            </Button>
          ))}
          {missingTerms.map((term) => (
            <p key={term.source}>
              {term.source} → {term.target}: 번역 전체에서 확정 표기를 찾지 못했어요.
            </p>
          ))}
        </div>
      </BottomSheet>
      <BottomSheet open={infoOpen} title="번역 정보" onClose={() => setInfoOpen(false)}>
        <div className="nr-reader-sheet-body">
          <p>저장 상태: {ownsPendingSave ? '저장 대기' : '저장 완료'}</p>
          <p>
            제공자:{' '}
            {displayVersion
              ? displayVersion.provenance.provider === 'gemini'
                ? 'Google Gemini'
                : 'OpenAI 호환'
              : '기록 없음'}
          </p>
          <p>모델: {displayVersion?.provenance.modelId ?? '기록 없음'}</p>
          <p>경과 시간: 기록 없음</p>
          {displayVersion?.provenance.generation && (
            <p>번역 방식: {displayVersion.provenance.generation.mode}</p>
          )}
        </div>
      </BottomSheet>
      <BottomSheet
        open={paragraphSheet !== null}
        title="문단 작업"
        onClose={() => setParagraphSheet(null)}
      >
        <div className="nr-reader-sheet-body">
          {paragraphSheet !== null && mayRepair && (
            <Button
              variant="text"
              onClick={() => {
                props.onRetryParagraphs?.([paragraphSheet]);
                setParagraphSheet(null);
              }}
            >
              이 문단 다시 번역하기
            </Button>
          )}
          {paragraphSheet !== null &&
            originalAvailable &&
            oneToOneParagraphs &&
            !props.showOriginal && (
              <Button
                variant="text"
                onClick={() => {
                  setParagraphSheet(null);
                  pendingOriginalIndex.current = paragraphSheet;
                  if (!props.showOriginal) toggleOriginal();
                }}
              >
                이 문단 원문 보기
              </Button>
            )}
          {!oneToOneParagraphs && (
            <p>원문과 번역 문단이 일대일로 대응하지 않아 문단별 작업을 제공하지 않아요.</p>
          )}
        </div>
      </BottomSheet>
      <Dialog
        open={titleEditorOpen}
        title="회차 제목 직접 수정하기"
        onClose={() => {
          if (!titleSaving) setTitleEditorOpen(false);
        }}
        actions={
          <>
            <Button variant="text" disabled={titleSaving} onClick={() => setTitleEditorOpen(false)}>
              닫기
            </Button>
            <Button
              variant="filled"
              disabled={titleSaving || !titleDraft.trim()}
              onClick={() => void saveTitle()}
            >
              저장하기
            </Button>
          </>
        }
      >
        <p lang="ja">원제: {version?.source.title ?? chapter.title}</p>
        <label className="nr-reader-title-input">
          제목 번역문
          <input
            value={titleDraft}
            maxLength={4096}
            onChange={(event) => setTitleDraft(event.target.value)}
          />
        </label>
        {titleError && <p role="alert">{titleError}</p>}
      </Dialog>
    </section>
  );
}

function translatedScrollPosition(body: HTMLElement, anchor: ParagraphAnchor | null): number {
  if (!anchor) return 0;
  const row = body.querySelector<HTMLElement>(`[data-reader-index="${anchor.index}"]`);
  return row ? row.offsetTop + anchor.offset : anchor.offset;
}
