import type { JSX } from 'react';
import type { RenewalSnapshot } from '../app/renewalController';
import type { TermScanChange, TermScanProgress } from '../translation/termScanRun';
import { Button } from './components/Button';
import { LinearProgress } from './components/LinearProgress';

export interface TermScanPanelProps {
  workId: string;
  savedCount: number;
  state: RenewalSnapshot['termScan'];
  onStart(): void;
  onCancel(): void;
  onRevert(source: string): void;
  onApplySuggestion(source: string): void;
  sources: { wikipedia: boolean; namuwiki: boolean };
}

type LookupSource = 'wikipedia' | 'namuwiki';
const LOOKUP_SOURCES: readonly LookupSource[] = ['wikipedia', 'namuwiki'];
const LOOKUP_LABEL: Record<LookupSource, string> = {
  wikipedia: '위키백과·위키데이터',
  namuwiki: '나무위키',
};

function lookupLabel(sources: readonly LookupSource[]): string {
  return sources.map((source) => LOOKUP_LABEL[source]).join(', ');
}

const CONFIDENCE_LABEL: Record<TermScanChange['confidence'], string> = {
  low: '신뢰도 낮음',
  medium: '신뢰도 보통',
  high: '신뢰도 높음',
};

/** 엔진 단계 문구. 모르는 단계는 문구 없이 진행 막대만 보인다. */
function progressText(progress: TermScanProgress | undefined): string | null {
  if (!progress) return null;
  if (progress.stage === 'collect')
    return `저장된 회차를 읽고 있어요 · ${progress.done}/${progress.total}`;
  if (progress.stage === 'judge')
    return `용어를 판정하고 있어요 · ${progress.done}/${progress.total}`;
  if (progress.stage === 'lookup')
    return `외부 사전에서 찾아보고 있어요 · ${progress.done}/${progress.total}`;
  if (progress.stage === 'save') return '용어집에 반영하고 있어요';
  return null;
}

function ConfidenceBadges({ change }: { change: TermScanChange }): JSX.Element {
  return (
    <p>
      <span className={`nr-scan-confidence nr-scan-confidence--${change.confidence}`}>
        {CONFIDENCE_LABEL[change.confidence]}
      </span>
      {change.kanaFlag && (
        <span className="nr-scan-confidence nr-scan-confidence--flag">발음 확인 필요</span>
      )}
    </p>
  );
}

function EvidenceList({ evidence }: { evidence: TermScanChange['evidence'] }): JSX.Element | null {
  if (evidence.length === 0) return null;
  return (
    <ul className="nr-scan-evidence">
      {evidence.map((item, index) => (
        <li key={index}>
          {item.url ? (
            <a href={item.url} target="_blank" rel="noreferrer">
              {item.note}
            </a>
          ) : (
            item.note
          )}
        </li>
      ))}
    </ul>
  );
}

export function TermScanPanel({
  workId,
  savedCount,
  state,
  onStart,
  onCancel,
  onRevert,
  onApplySuggestion,
  sources,
}: TermScanPanelProps): JSX.Element {
  const scan = state?.workId === workId ? state : null;

  const enabledSources = LOOKUP_SOURCES.filter((source) => sources[source]);

  const startView = (
    <>
      <p>
        저장된 회차 {savedCount}화의 원문에서 이름·별명을 모아, 모델이 문맥과 한자 뜻을 보고 표기를
        다시 정해요. 바뀐 용어는 용어집에 바로 반영되고, 직접 고친 용어는 바꾸지 않고 제안만 보여
        줘요.
      </p>
      {enabledSources.length > 0 ? (
        <p>{`켜 둔 외부 조회(${lookupLabel(enabledSources)})에는 용어 이름만 보내요.`}</p>
      ) : (
        <p>
          설정에서 위키백과·나무위키 조회를 켜면 실존 인물과 작품 이름을 더 정확히 찾을 수 있어요.
        </p>
      )}
      <p>모델 요청이 여러 번 나가서 몇 분 걸릴 수 있어요.</p>
      <Button variant="filled" disabled={savedCount === 0} onClick={() => onStart()}>
        정밀스캔 시작하기
      </Button>
    </>
  );

  if (!scan) return startView;

  if (scan.phase === 'running') {
    const text = progressText(scan.progress);
    const progress = scan.progress;
    const value = progress && progress.total > 0 ? progress.done / progress.total : undefined;
    return (
      <>
        {text && <p>{text}</p>}
        <LinearProgress label={text ?? '용어 정밀스캔 진행'} value={value} />
        <Button variant="text" onClick={() => onCancel()}>
          중단
        </Button>
      </>
    );
  }

  if (scan.phase === 'failed') {
    return (
      <>
        <p role="alert">{scan.error}</p>
        <Button variant="filled" onClick={() => onStart()}>
          다시 시도하기
        </Button>
      </>
    );
  }

  if (scan.phase === 'cancelled') {
    return (
      <>
        <p>정밀스캔을 중단했어요. 용어집은 바뀌지 않았어요.</p>
        <Button variant="filled" onClick={() => onStart()}>
          다시 시작하기
        </Button>
      </>
    );
  }

  const result = scan.result;
  if (!result) return startView;
  const handled = scan.handled;
  return (
    <>
      <p>{`바꾼 용어 ${result.applied.length}개 · 확인한 용어 ${result.confirmed}개 · 제안 ${result.suggestions.length}개`}</p>
      {result.partial && <p role="status">일부 판정 요청이 실패해서 나머지 결과만 반영했어요.</p>}
      {result.lookupFailed && result.lookupFailed.length > 0 && (
        <p role="status">
          {`${lookupLabel(result.lookupFailed)} 조회가 안 돼서 그 근거 없이 판정했어요.`}
        </p>
      )}
      {result.applied.length > 0 && (
        <section>
          <h3>바꾼 용어</h3>
          <ul className="nr-scan-list">
            {result.applied.map((change) => {
              const done = handled.includes(change.source);
              return (
                <li key={change.source}>
                  <p>
                    <span lang="ja">{change.source}</span>{' '}
                    <span>{`${change.before ?? '새로 추가'} → ${change.after}`}</span>
                  </p>
                  <ConfidenceBadges change={change} />
                  <p>{change.reason}</p>
                  <EvidenceList evidence={change.evidence} />
                  <Button variant="text" disabled={done} onClick={() => onRevert(change.source)}>
                    {done ? '되돌렸어요' : '되돌리기'}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {result.suggestions.length > 0 && (
        <section>
          <h3>확인이 필요한 제안</h3>
          <ul className="nr-scan-list">
            {result.suggestions.map((item) => {
              const done = handled.includes(item.source);
              return (
                <li key={item.source}>
                  <p>
                    <span lang="ja">{item.source}</span>
                  </p>
                  <p>{`지금 ${item.before ?? ''} · 제안 ${item.after}`}</p>
                  <ConfidenceBadges change={item} />
                  <p>{item.reason}</p>
                  <EvidenceList evidence={item.evidence} />
                  <Button
                    variant="tonal"
                    disabled={done}
                    onClick={() => onApplySuggestion(item.source)}
                  >
                    {done ? '적용했어요' : '제안 적용'}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <p>이미 번역한 회차는 리더 메뉴의 ‘이 화 다시 번역하기’로 새 용어집을 적용할 수 있어요.</p>
      <Button variant="text" onClick={() => onStart()}>
        다시 정밀스캔하기
      </Button>
    </>
  );
}
