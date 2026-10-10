// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRenewalController, type RenewalSnapshot } from '../../src/app/renewalController';
import { SettingsScreen } from '../../src/ui/SettingsScreen';

// 실제 모델 크기(164,626,432바이트)다. 화면은 십진 MB로 표기해 165MB가 된다(확인 문구 '약 165MB'와 일치).
const MODEL_BYTES = 164626432;
const SWITCH = '기기에서 용어 판정 모델 쓰기';
const DOWNLOAD_TITLE = '판정 모델을 내려받을까요?';
const DOWNLOAD_BODY =
  'EmbeddingGemma 2(약 165MB)를 Hugging Face에서 내려받아 이 기기에 저장해요. Wi-Fi에서 받는 걸 권장해요. 원문과 번역은 기기 밖으로 보내지 않아요.';
const REMOVE_TITLE = '판정 모델을 지울까요?';
const REMOVE_BODY = '다시 쓰려면 다시 내려받아야 해요.';

afterEach(() => {
  cleanup();
});

function embeddingState(overrides: Partial<RenewalSnapshot> = {}): RenewalSnapshot {
  return {
    ...createRenewalController().getSnapshot(),
    embeddingAvailable: true,
    ...overrides,
  };
}

function installed(overrides: Partial<NonNullable<RenewalSnapshot['embeddingModel']>> = {}) {
  return { installed: true, bytes: MODEL_BYTES, downloading: false, ...overrides };
}

function renderSettings(state: RenewalSnapshot) {
  const handlers = {
    onEnableEmbedding: vi.fn(),
    onDisableEmbedding: vi.fn(),
    onCancelEmbeddingDownload: vi.fn(),
    onRemoveEmbeddingModel: vi.fn(),
  };
  render(
    <SettingsScreen
      state={state}
      onChange={() => {}}
      onCheck={async () => ({ kind: 'superseded' as const })}
      onSelect={() => {}}
      onAutoRetryFailed={() => {}}
      {...handlers}
    />,
  );
  return handlers;
}

describe('용어 판정 설정 섹션', () => {
  it('네이티브 판정 모델을 쓸 수 있을 때만 섹션을 보여 준다', () => {
    renderSettings(embeddingState({ embeddingAvailable: false }));
    expect(screen.queryByRole('heading', { name: '용어 판정' })).not.toBeInTheDocument();
    cleanup();

    renderSettings(
      embeddingState({ embeddingModel: { installed: false, bytes: 0, downloading: false } }),
    );
    expect(screen.getByRole('heading', { name: '용어 판정' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: SWITCH })).not.toBeChecked();
  });

  it('설치되지 않은 모델을 켜면 내려받기 확인을 거친 뒤에만 켠다', () => {
    const handlers = renderSettings(
      embeddingState({ embeddingModel: { installed: false, bytes: 0, downloading: false } }),
    );

    fireEvent.click(screen.getByRole('switch', { name: SWITCH }));
    expect(handlers.onEnableEmbedding).not.toHaveBeenCalled();
    expect(screen.getByText(DOWNLOAD_TITLE)).toBeVisible();
    expect(screen.getByText(DOWNLOAD_BODY)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(handlers.onEnableEmbedding).not.toHaveBeenCalled();
    expect(screen.queryByText(DOWNLOAD_TITLE)).toBeNull();

    fireEvent.click(screen.getByRole('switch', { name: SWITCH }));
    fireEvent.click(screen.getByRole('button', { name: '내려받기' }));
    expect(handlers.onEnableEmbedding).toHaveBeenCalledTimes(1);
  });

  it('설치된 모델이면 확인 없이 바로 켜고, 끌 때도 확인 없이 끈다', () => {
    const on = renderSettings(embeddingState({ embeddingModel: installed() }));
    fireEvent.click(screen.getByRole('switch', { name: SWITCH }));
    expect(on.onEnableEmbedding).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(DOWNLOAD_TITLE)).toBeNull();
    cleanup();

    const off = renderSettings(
      embeddingState({ onDeviceEmbedding: true, embeddingModel: installed() }),
    );
    expect(screen.getByRole('switch', { name: SWITCH })).toBeChecked();
    fireEvent.click(screen.getByRole('switch', { name: SWITCH }));
    expect(off.onDisableEmbedding).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(DOWNLOAD_TITLE)).toBeNull();
  });

  it('받는 중에는 진행 막대와 받은 양을 보여 주고 중단할 수 있다', () => {
    const handlers = renderSettings(
      embeddingState({
        embeddingModel: {
          installed: false,
          bytes: 0,
          downloading: true,
          progress: { received: 50_000_000, total: MODEL_BYTES },
        },
      }),
    );

    const bar = screen.getByRole('progressbar', { name: '판정 모델 내려받기' });
    expect(bar).toHaveAttribute('aria-valuenow', '30');
    expect(screen.getByText('내려받는 중 · 50/165MB')).toBeVisible();

    // 받는 중에는 스위치를 눌러도 확인 대화상자를 다시 열지 않는다.
    fireEvent.click(screen.getByRole('switch', { name: SWITCH }));
    expect(screen.queryByText(DOWNLOAD_TITLE)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '중단' }));
    expect(handlers.onCancelEmbeddingDownload).toHaveBeenCalledTimes(1);
  });

  it('내려받기 실패 안내를 경고 문구로 보여 준다', () => {
    renderSettings(
      embeddingState({
        embeddingModel: {
          installed: false,
          bytes: 0,
          downloading: false,
          error: '판정 모델을 내려받지 못했어요. 연결을 확인하고 다시 시도해 주세요.',
        },
      }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      '판정 모델을 내려받지 못했어요. 연결을 확인하고 다시 시도해 주세요.',
    );
  });

  it('설치된 모델의 크기를 보여 주고 지우기 전에 확인한다', () => {
    const handlers = renderSettings(
      embeddingState({ onDeviceEmbedding: true, embeddingModel: installed() }),
    );
    expect(screen.getByText('설치된 판정 모델 · 165MB')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '모델 지우기' }));
    expect(handlers.onRemoveEmbeddingModel).not.toHaveBeenCalled();
    expect(screen.getByText(REMOVE_TITLE)).toBeVisible();
    expect(screen.getByText(REMOVE_BODY)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(handlers.onRemoveEmbeddingModel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '모델 지우기' }));
    fireEvent.click(screen.getByRole('button', { name: '지우기' }));
    expect(handlers.onRemoveEmbeddingModel).toHaveBeenCalledTimes(1);
  });
});
