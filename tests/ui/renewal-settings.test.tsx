// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Application } from '../../src/app/Application';
import {
  createRenewalController,
  type ConnectionCheckResult,
  type RenewalDependencies,
  type RenewalSnapshot,
} from '../../src/app/renewalController';
import { ReaderError } from '../../src/contracts';
import type { ConnectionConfig, ModelChoice } from '../../src/contracts/reading';
import { GEMINI_BASE_URL } from '../../src/providers/gemini';
import type { BackupPlatform, BackupResult } from '../../src/platform/backup';
import type { ShellPlatform } from '../../src/platform/shell';
import type { ReadingSettings } from '../../src/storage/settings';
import {
  composePresetAddress,
  parsePresetAddress,
  SettingsScreen,
} from '../../src/ui/SettingsScreen';
import { SnackbarProvider } from '../../src/ui/components/Snackbar';
import packageInfo from '../../package.json';

vi.mock('@capacitor/app', () => ({
  App: {
    getInfo: vi.fn(async () => ({
      name: 'JHF Novel Reader',
      id: 'com.example.reader',
      build: '0',
      version: '0.0.0',
    })),
  },
}));

const models: readonly ModelChoice[] = [
  { id: 'generation', displayName: 'Generation model', supportsGeneration: true },
  { id: 'embedding', displayName: 'Embedding model', supportsGeneration: false },
];

function savedSettings(authRef?: string): ReadingSettings {
  return {
    schemaVersion: 2,
    fontSize: 18,
    selection: authRef
      ? {
          connection: {
            provider: 'openai-compatible',
            baseUrl: 'http://192.0.2.1/v1',
            revision: 4,
            authRef,
          },
          modelId: 'generation',
          translationMode: 'stream',
        }
      : null,
  };
}

function platform() {
  let back: (() => void) | null = null;
  const value: ShellPlatform & { pressBack(): void } = {
    onBackButton(listener) {
      back = listener;
      return () => {
        back = null;
      };
    },
    moveToBackground: vi.fn(),
    setSystemBarsTheme: vi.fn(),
    setKeepAwake: vi.fn(),
    markReady: vi.fn(),
    pressBack: () => back?.(),
  };
  return value;
}

async function setup(
  options: {
    readonly saved?: ReadingSettings;
    readonly catalog?: RenewalDependencies['catalog'];
    readonly streamingAvailable?: boolean;
  } = {},
) {
  let persisted = options.saved ?? savedSettings();
  const saveReadingSettings = vi.fn(async (value: ReadingSettings) => {
    persisted = value;
  });
  const catalog =
    options.catalog ??
    vi.fn(async (connection: ConnectionConfig, secret: string) => ({
      connection: secret ? { ...connection, authRef: 'provider.saved' } : connection,
      models,
    }));
  const post = vi.fn(async () => {});
  const shell = platform();
  const dependencies: RenewalDependencies = {
    settings: {
      readReadingSettings: vi.fn(async () => persisted),
      saveReadingSettings,
    },
    catalog,
    streamingAvailable: options.streamingAvailable ?? true,
    startTranslation: post,
  };
  const controller = createRenewalController(dependencies);
  render(<Application controller={controller} platform={shell} />);
  await waitFor(() => expect(dependencies.settings?.readReadingSettings).toHaveBeenCalled());
  act(() => controller.navigate({ kind: 'settings' }));
  await screen.findByRole('heading', { level: 1, name: '설정' });
  return { controller, catalog, post, saveReadingSettings, shell, persisted: () => persisted };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Android 목록형 설정', () => {
  it('네 섹션과 웹 버전·실제 오픈소스 고지를 정보 행으로 보여 줘요', async () => {
    const value = await setup();

    for (const name of ['번역 서버', '번역 방식', '화면', '정보']) {
      expect(screen.getByRole('heading', { name })).toBeVisible();
    }
    expect(screen.getByText(`웹 미리보기 ${packageInfo.version}`)).toBeVisible();
    expect(screen.queryByRole('button', { name: '버전' })).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: '오픈소스 라이선스 포함된 오픈소스와 라이선스',
      }),
    ).toHaveTextContent('포함된 오픈소스와 라이선스');
    expect(screen.getByText('아직 기록이 없어요')).toBeVisible();
    expect(screen.queryByRole('button', { name: '최근 번역 시간' })).not.toBeInTheDocument();
    expect(document.querySelector('details')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', {
        name: '오픈소스 라이선스 포함된 오픈소스와 라이선스',
      }),
    );
    expect(screen.getByRole('dialog', { name: '오픈소스 라이선스' })).not.toHaveTextContent(
      'Android scaffold',
    );
    value.controller.dispose();
  });

  it('오픈소스 라이선스 전체 화면에 실제 구성 요소와 원문을 지연 로드해 보여 줘요(#142)', async () => {
    const value = await setup();

    fireEvent.click(
      screen.getByRole('button', {
        name: '오픈소스 라이선스 포함된 오픈소스와 라이선스',
      }),
    );
    const dialog = screen.getByRole('dialog', { name: '오픈소스 라이선스' });
    expect(dialog).toHaveClass('nr-dialog--fullscreen');
    for (const name of ['react', 'androidx.core:core', 'Pretendard Variable']) {
      expect(
        await within(dialog).findByText(name, { selector: '.nr-license__name' }),
      ).toBeInTheDocument();
    }
    expect(
      within(dialog).getAllByText(/Permission is hereby granted/, { selector: 'pre' }).length,
    ).toBeGreaterThan(0);
    value.controller.dispose();
  });

  it('대화상자로 이어지는 행만 › 표시와 강조색 값으로 구분하고 정보 행은 그대로 둬요(#140)', async () => {
    const value = await setup();

    const rowOf = (name: string) =>
      screen
        .getByText(name, { selector: '.nr-list-item__headline' })
        .closest('.nr-list-item') as HTMLElement;
    for (const name of ['제공자', '모델', '로컬 번역 방식', '테마', '오픈소스 라이선스']) {
      const row = rowOf(name);
      expect(row, name).toHaveClass('nr-list-item--navigates');
      expect(
        row.querySelector('.nr-list-item__main [data-icon="chevron_right"]'),
        name,
      ).not.toBeNull();
    }
    const timingRow = rowOf('최근 번역 시간');
    expect(timingRow).not.toHaveClass('nr-list-item--navigates');
    expect(timingRow.querySelector('[data-icon="chevron_right"]')).toBeNull();
    value.controller.dispose();
  });

  it('정보 섹션에는 오픈소스 라이선스만 남기고 최근 번역 시간은 번역 방식에 둬요(#143)', async () => {
    const value = await setup();

    const info = screen.getByRole('region', { name: '정보' });
    expect(within(info).queryByText('버전')).not.toBeInTheDocument();
    expect(within(info).queryByText('최근 번역 시간')).not.toBeInTheDocument();
    expect(
      within(info).getByRole('button', { name: '오픈소스 라이선스 포함된 오픈소스와 라이선스' }),
    ).toBeVisible();
    const translation = screen.getByRole('region', { name: '번역 방식' });
    expect(within(translation).getByText('최근 번역 시간')).toBeVisible();
    expect(within(translation).getByText('아직 기록이 없어요')).toBeVisible();
    value.controller.dispose();
  });

  it('설정 섹션의 목록 항목이 아닌 내용만 같은 왼쪽 선 규칙에 걸려요(#270)', async () => {
    const value = await setup();

    const root = screen.getByRole('region', { name: '설정' });
    expect(root).toHaveClass('nr-settings');
    // application.css의 규칙과 같은 선택자. 규칙 원문이 바뀌면 이 시험도 함께 고친다.
    const aligned = [
      ...root.querySelectorAll('.nr-settings > section > :not(.nr-list-item, .nr-switch-row)'),
    ];
    const server = screen.getByRole('region', { name: '번역 서버' });
    expect(aligned).toContain(within(server).getByRole('heading', { name: '번역 서버' }));
    expect(aligned).toContain(
      within(server).getByLabelText('서버 주소').closest('.nr-address-preset'),
    );
    expect(aligned).toContain(within(server).getByRole('button', { name: '연결 확인하기' }));
    // 목록 항목·스위치 행(자체 padding), 푸터, 대화상자는 걸리지 않는다.
    expect(aligned).not.toContain(within(server).getByText('연결 상태').closest('.nr-list-item'));
    expect(aligned.some((element) => element.classList.contains('nr-switch-row'))).toBe(false);
    expect(aligned.some((element) => element.classList.contains('nr-list-item'))).toBe(false);
    expect(aligned.some((element) => element.closest('.nr-settings-footer'))).toBe(false);
    expect(aligned.some((element) => element.closest('.nr-modal'))).toBe(false);
    const rule = readFileSync('src/app/application.css', 'utf8');
    expect(rule).toMatch(
      /\.nr-settings > section > :not\(\.nr-list-item, \.nr-switch-row\) \{\s*margin-inline: 16px;\s*\}/,
    );
    value.controller.dispose();
  });

  it('실패한 문단 자동 재번역 설명은 로컬 서버 재전송을 함께 알려요(#270)', async () => {
    const value = await setup();

    expect(
      screen.getByText(
        '읽으며 번역에서 검증에 실패한 문단만 한 번 더 번역해요. 로컬 서버가 응답 없이 멈춘 요청도 한 번 다시 보내요.',
      ),
    ).toBeVisible();
    value.controller.dispose();
  });

  it('설정 끝 브랜드 footer에 로고와 앱 이름, 웹 버전을 정보 섹션 뒤에 보여 줘요(#143)', async () => {
    const value = await setup();

    const footer = document.querySelector('.nr-settings-footer') as HTMLElement;
    expect(footer).not.toBeNull();
    expect(footer.querySelector('img')).toHaveAttribute('alt', '');
    expect(within(footer).getByText('JHF Novel Reader')).toBeVisible();
    expect(within(footer).getByText(`웹 미리보기 ${packageInfo.version}`)).toBeVisible();
    const info = screen.getByRole('region', { name: '정보' });
    expect(info.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    value.controller.dispose();
  });

  it('네이티브 앱에서는 footer에 앱 버전과 빌드 번호를 보여 줘요(#143)', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.mocked(App.getInfo).mockResolvedValue({
      name: 'JHF Novel Reader',
      id: 'com.example.reader',
      build: '7',
      version: '1.2.3',
    });
    const value = await setup();

    const footer = document.querySelector('.nr-settings-footer') as HTMLElement;
    expect(await within(footer).findByText('버전 1.2.3 (build 7)')).toBeVisible();
    value.controller.dispose();
  });

  it('설정 행의 접근성 이름에 현재 값을 포함해요', async () => {
    const value = await setup();

    expect(screen.getByRole('button', { name: '제공자 LM Studio / Ollama' })).toHaveAccessibleName(
      '제공자 LM Studio / Ollama',
    );
    expect(
      screen.getByRole('button', { name: '로컬 번역 방식 기존 묶음 방식' }),
    ).toHaveAccessibleName('로컬 번역 방식 기존 묶음 방식');
    value.controller.dispose();
  });

  it('웹에서는 자동 설정 스위치를 유지하고 로컬 번역 방식만 숨겨요', async () => {
    const value = await setup({ streamingAvailable: false });

    expect(screen.getAllByRole('switch')).toHaveLength(4);
    expect(screen.getByRole('switch', { name: '번역 전 용어집 자동 생성' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /^로컬 번역 방식/ })).not.toBeInTheDocument();
    value.controller.dispose();
  });

  it('Gemini는 고지를 승인하기 전까지 설정과 요청을 그대로 둬요', async () => {
    const value = await setup();
    const before = structuredClone(value.controller.getSnapshot().connection);

    fireEvent.click(screen.getByRole('button', { name: '제공자 LM Studio / Ollama' }));
    const providerGroup = screen.getByRole('radiogroup', { name: '제공자 선택' });
    expect(providerGroup.querySelectorAll('button')).toHaveLength(0);
    expect(providerGroup.querySelectorAll('input[type="radio"]')).toHaveLength(2);
    fireEvent.click(screen.getByRole('radio', { name: 'Google Gemini' }));
    expect(screen.getByRole('dialog', { name: 'Gemini를 사용할까요?' })).toBeVisible();
    expect(screen.getByText(/비용이 발생할 수 있어요/)).toBeVisible();
    expect(screen.getByText(/회차 원문을 Google로 전송해요/)).toBeVisible();
    expect(screen.getByText('다른 제공자로 자동으로 바꾸지 않아요.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));

    expect(value.controller.getSnapshot().connection).toEqual(before);
    expect(value.catalog).not.toHaveBeenCalled();
    expect(value.post).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '제공자 LM Studio / Ollama' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Google Gemini' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gemini 사용하기' }));
    expect(value.controller.getSnapshot().connection).toEqual({
      provider: 'gemini',
      baseUrl: GEMINI_BASE_URL,
      revision: before.revision + 1,
    });
    expect(value.catalog).not.toHaveBeenCalled();
    expect(value.post).not.toHaveBeenCalled();
    value.controller.dispose();
  });

  it('같은 제공자를 다시 골라도 연결·선택·revision을 초기화하지 않아요', async () => {
    const value = await setup({ saved: savedSettings('provider.existing') });
    const before = structuredClone(value.controller.getSnapshot());

    fireEvent.click(screen.getByRole('button', { name: '제공자 LM Studio / Ollama' }));
    fireEvent.click(screen.getByRole('radio', { name: 'LM Studio / Ollama' }));

    expect(value.controller.getSnapshot().connection).toEqual(before.connection);
    expect(value.controller.getSnapshot().selectedModelId).toBe(before.selectedModelId);
    expect(value.catalog).not.toHaveBeenCalled();
    value.controller.dispose();
  });

  it('같은 번역 방식을 다시 골라도 revision을 올리거나 저장하지 않아요', async () => {
    const value = await setup({ saved: savedSettings('provider.existing') });
    value.saveReadingSettings.mockClear();
    const before = value.controller.getSnapshot().connection.revision;

    value.controller.changeTranslationMode('stream');

    expect(value.controller.getSnapshot().connection.revision).toBe(before);
    expect(value.saveReadingSettings).not.toHaveBeenCalled();
    value.controller.dispose();
  });

  it('같은 모델을 다시 골라도 상태를 바꾸거나 저장과 자동 요청을 반복하지 않아요', async () => {
    const value = await setup({ saved: savedSettings('provider.existing') });
    fireEvent.click(screen.getByRole('button', { name: '연결 확인하기' }));
    await screen.findByRole('button', { name: '모델 Generation model' });
    await waitFor(() => expect(value.saveReadingSettings).toHaveBeenCalled());
    value.saveReadingSettings.mockClear();
    const before = value.controller.getSnapshot();

    value.controller.chooseModel('generation');
    await Promise.resolve();
    await Promise.resolve();

    expect(value.controller.getSnapshot().connection.revision).toBe(before.connection.revision);
    expect(value.controller.getSnapshot().catalogStatus).toBe(before.catalogStatus);
    expect(value.saveReadingSettings).not.toHaveBeenCalled();
    expect(value.post).not.toHaveBeenCalled();
    value.controller.dispose();
  });

  it('모델 대화상자에서 생성 불가 모델을 비활성화하고 현재 선택을 유지해요', async () => {
    const value = await setup({ saved: savedSettings('provider.existing') });
    fireEvent.click(screen.getByRole('button', { name: '연결 확인하기' }));
    await screen.findByRole('button', { name: '모델 Generation model' });
    fireEvent.click(screen.getByRole('button', { name: '모델 Generation model' }));

    expect(screen.getByRole('radio', { name: 'Embedding model' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Generation model' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Embedding model' }));
    expect(screen.getByRole('dialog', { name: '모델 선택' })).toBeVisible();
    expect(value.controller.getSnapshot().selectedModelId).toBe('generation');
    expect(value.post).not.toHaveBeenCalled();
    value.controller.dispose();
  });

  it('미저장 인증값은 연결 확인 직전에 DOM에서 지우고 실패 뒤에도 노출하지 않아요', async () => {
    const catalog = vi.fn(async () => {
      throw new Error('synthetic connection failure');
    });
    const value = await setup({ catalog });
    fireEvent.change(screen.getByLabelText('서버 주소'), { target: { value: '192.0.2.1' } });
    const input = screen.getByLabelText('인증값 (선택)');
    fireEvent.change(input, { target: { value: 'private-secret-canary' } });
    fireEvent.click(screen.getByRole('button', { name: '연결 확인하기' }));

    expect(input).toHaveValue('');
    await screen.findByText('모델 목록을 불러오지 못했어요. 잠시 뒤 다시 확인해 주세요.');
    expect(document.body).not.toHaveTextContent('private-secret-canary');
    expect(value.post).not.toHaveBeenCalled();
    value.controller.dispose();
  });

  it('저장한 인증값의 변경 취소와 빈 확인은 기존 참조를 보존해요', async () => {
    const value = await setup({ saved: savedSettings('provider.existing') });
    expect(screen.getByRole('button', { name: '인증값 저장됨' })).toHaveTextContent('저장됨');

    fireEvent.click(screen.getByRole('button', { name: '변경' }));
    fireEvent.change(screen.getByLabelText('새 인증값'), { target: { value: 'discard-me' } });
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(screen.queryByLabelText('새 인증값')).toBeNull();
    expect(value.controller.getSnapshot().connection.authRef).toBe('provider.existing');

    fireEvent.click(screen.getByRole('button', { name: '변경' }));
    fireEvent.click(screen.getByRole('button', { name: '저장하기' }));
    await waitFor(() => expect(value.catalog).toHaveBeenCalledTimes(1));
    expect(value.catalog).toHaveBeenCalledWith(
      expect.objectContaining({ authRef: 'provider.existing' }),
      '',
      expect.any(AbortSignal),
    );
    expect(value.controller.getSnapshot().connection.authRef).toBe('provider.existing');
    value.controller.dispose();
  });

  it('주소가 비어 있으면 인증값 입력과 저장하기를 비활성으로 둬요', async () => {
    const value = await setup({ saved: savedSettings('provider.existing') });
    fireEvent.click(screen.getByRole('button', { name: '인증값 저장됨' }));
    fireEvent.change(screen.getByLabelText('서버 주소'), { target: { value: '' } });

    expect(screen.getByLabelText('새 인증값')).toBeDisabled();
    expect(screen.getByRole('button', { name: '저장하기' })).toBeDisabled();
    value.controller.dispose();
  });

  it('저장된 인증값을 바꿀 때 비워 두면 기존 인증값을 유지한다고 안내해요', async () => {
    const value = await setup({ saved: savedSettings('provider.existing') });
    fireEvent.click(screen.getByRole('button', { name: '인증값 저장됨' }));

    const dialog = screen.getByRole('dialog', { name: '인증값 변경' });
    expect(
      within(dialog).getByText(
        '새 인증값은 이 기기의 보안 저장소에 저장해요. 비워 두고 저장하면 기존 인증값을 유지해요.',
      ),
    ).toBeVisible();
    expect(dialog).not.toHaveTextContent('인증이 없는 서버라면');
    value.controller.dispose();
  });

  it('인증값이 없을 때 인증값 입력은 비워 두라는 안내를 설명으로 연결해요', async () => {
    const value = await setup();
    const input = screen.getByLabelText('인증값 (선택)');

    expect(input).toHaveAccessibleDescription(
      '인증값은 이 기기의 보안 저장소에 저장해요. 인증이 없는 서버라면 비워 두세요.',
    );
    value.controller.dispose();
  });

  it('제공자를 Gemini에서 LM Studio로 바꾸면 연결 변경을 한 번만 기록해요', async () => {
    const value = await setup({
      saved: {
        schemaVersion: 2,
        fontSize: 18,
        selection: {
          connection: { provider: 'gemini', baseUrl: GEMINI_BASE_URL, revision: 4 },
          modelId: 'generation',
          translationMode: 'stream',
        },
      },
    });
    const before = value.controller.getSnapshot().connection.revision;

    fireEvent.click(screen.getByRole('button', { name: '제공자 Google Gemini' }));
    fireEvent.click(screen.getByRole('radio', { name: 'LM Studio / Ollama' }));

    expect(value.controller.getSnapshot().connection.provider).toBe('openai-compatible');
    expect(value.controller.getSnapshot().connection.revision).toBe(before + 1);
    value.controller.dispose();
  });

  it('번역 방식 대화상자에서 저장본 호환성을 안내해요', async () => {
    const value = await setup();
    fireEvent.click(screen.getByRole('button', { name: '로컬 번역 방식 기존 묶음 방식' }));

    expect(screen.getByText('저장된 번역은 어느 방식에서나 읽을 수 있어요.')).toBeVisible();
    value.controller.dispose();
  });

  it('현재 테마를 다시 누르면 선택 대화상자를 닫아요', async () => {
    const value = await setup();
    fireEvent.click(screen.getByRole('button', { name: '테마 시스템 설정 따르기' }));

    fireEvent.click(screen.getByRole('radio', { name: '시스템 설정 따르기' }));

    expect(screen.queryByRole('dialog', { name: '테마 선택' })).not.toBeInTheDocument();
    value.controller.dispose();
  });

  it('스위치와 테마 선택을 v2 설정에 저장하고 재시작 뒤 복원해요', async () => {
    const value = await setup();
    fireEvent.click(screen.getByRole('switch', { name: '저장본이 없으면 자동으로 번역 시작' }));
    fireEvent.click(screen.getByRole('switch', { name: '실패한 문단 자동으로 다시 번역' }));
    fireEvent.click(screen.getByRole('button', { name: '테마 시스템 설정 따르기' }));
    fireEvent.click(screen.getByRole('radio', { name: '다크' }));

    await waitFor(() =>
      expect(value.persisted()).toMatchObject({
        schemaVersion: 2,
        autoTranslate: false,
        autoRetryFailed: false,
        theme: 'dark',
      }),
    );
    expect(document.documentElement.dataset.theme).toBe('dark');
    value.controller.dispose();
  });

  it('대화상자는 Esc와 시스템 Back으로 닫히고 연 버튼으로 포커스를 돌려줘요', async () => {
    const value = await setup();
    const provider = screen.getByRole('button', { name: '제공자 LM Studio / Ollama' });
    provider.focus();
    fireEvent.click(provider);
    const dialog = screen.getByRole('dialog', { name: '제공자 선택' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '제공자 선택' })).toBeNull();
    expect(provider).toHaveFocus();

    fireEvent.click(provider);
    act(() => value.shell.pressBack());
    expect(screen.queryByRole('dialog', { name: '제공자 선택' })).toBeNull();
    expect(provider).toHaveFocus();
    value.controller.dispose();
  });
});

function savedAddress(baseUrl: string): ReadingSettings {
  return {
    schemaVersion: 2,
    fontSize: 18,
    selection: {
      connection: { provider: 'openai-compatible', baseUrl, revision: 4 },
      modelId: 'generation',
      translationMode: 'stream',
    },
  };
}

describe('OpenAI 호환 서버 주소 프리셋', () => {
  it('저장 주소가 없으면 서버 주소와 포트 입력과 안내를 보여 줘요', async () => {
    const value = await setup();

    expect(screen.getByLabelText('서버 주소')).toHaveAttribute('placeholder', '192.168.0.10');
    expect(screen.getByLabelText('포트')).toHaveAttribute('placeholder', '1234');
    expect(
      screen.getByText(
        'PC의 LAN 주소나 VPN 주소와 서버 포트를 적어 주세요. 기본 포트는 LM Studio 1234, Ollama 11434, llama.cpp 서버 8080이에요.',
      ),
    ).toBeVisible();
    value.controller.dispose();
  });

  it('서버 주소와 포트를 입력하면 완성 주소를 저장하고 보여 줘요', async () => {
    const value = await setup();

    fireEvent.change(screen.getByLabelText('서버 주소'), { target: { value: '192.168.0.10' } });
    fireEvent.change(screen.getByLabelText('포트'), { target: { value: '1234' } });

    expect(value.controller.getSnapshot().connection.baseUrl).toBe('http://192.168.0.10:1234/v1');
    expect(screen.getByText('완성 주소: http://192.168.0.10:1234/v1')).toBeVisible();
    value.controller.dispose();
  });

  it('자주 쓰는 포트 칩을 누르면 포트를 채우고 선택 상태를 보여 줘요', async () => {
    const value = await setup();
    fireEvent.change(screen.getByLabelText('서버 주소'), { target: { value: '192.168.0.10' } });

    fireEvent.click(screen.getByRole('button', { name: 'Ollama 11434' }));

    expect(value.controller.getSnapshot().connection.baseUrl).toBe('http://192.168.0.10:11434/v1');
    expect(screen.getByLabelText('포트')).toHaveValue('11434');
    expect(screen.getByRole('button', { name: 'Ollama 11434' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    value.controller.dispose();
  });

  it('llama.cpp 8080 칩을 누르면 포트를 채우고 선택 상태를 보여 줘요', async () => {
    const value = await setup();
    fireEvent.change(screen.getByLabelText('서버 주소'), { target: { value: '100.73.103.1' } });

    fireEvent.click(screen.getByRole('button', { name: 'llama.cpp 8080' }));

    expect(value.controller.getSnapshot().connection.baseUrl).toBe('http://100.73.103.1:8080/v1');
    expect(screen.getByLabelText('포트')).toHaveValue('8080');
    expect(screen.getByRole('button', { name: 'llama.cpp 8080' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    value.controller.dispose();
  });

  it('포트 칸에는 숫자만 남기고 다섯 자리까지만 받아요', async () => {
    const value = await setup();

    fireEvent.change(screen.getByLabelText('포트'), { target: { value: '12a34' } });

    expect(screen.getByLabelText('포트')).toHaveValue('1234');
    value.controller.dispose();
  });

  it('저장 주소를 해석할 수 있으면 서버 주소와 포트 칸에 나눠 보여 줘요', async () => {
    const value = await setup({ saved: savedAddress('http://100.64.1.2:1234/v1') });

    expect(screen.getByLabelText('서버 주소')).toHaveValue('100.64.1.2');
    expect(screen.getByLabelText('포트')).toHaveValue('1234');
    expect(screen.getByRole('switch', { name: '전체 주소 직접 입력' })).not.toBeChecked();
    value.controller.dispose();
  });

  it('해석할 수 없는 저장 주소는 스위치를 켜고 전체 주소 칸에 그대로 보여 줘요', async () => {
    const value = await setup({ saved: savedAddress('https://proxy.example/api/v1') });

    expect(screen.getByRole('switch', { name: '전체 주소 직접 입력' })).toBeChecked();
    expect(screen.getByLabelText('API 기본 주소')).toHaveValue('https://proxy.example/api/v1');
    expect(screen.queryByLabelText('서버 주소')).toBeNull();
    expect(screen.queryByLabelText('포트')).toBeNull();
    value.controller.dispose();
  });

  it('전체 주소 직접 입력에서는 입력한 주소를 그대로 저장해요', async () => {
    const value = await setup();

    fireEvent.click(screen.getByRole('switch', { name: '전체 주소 직접 입력' }));
    fireEvent.change(screen.getByLabelText('API 기본 주소'), {
      target: { value: 'https://other.example/v1' },
    });

    expect(value.controller.getSnapshot().connection.baseUrl).toBe('https://other.example/v1');
    value.controller.dispose();
  });

  it('제공자가 Gemini면 주소·포트 칸과 스위치를 보여 주지 않아요', async () => {
    const value = await setup({
      saved: {
        schemaVersion: 2,
        fontSize: 18,
        selection: {
          connection: { provider: 'gemini', baseUrl: GEMINI_BASE_URL, revision: 4 },
          modelId: 'generation',
          translationMode: 'stream',
        },
      },
    });

    expect(screen.getByLabelText('API 기본 주소')).toHaveValue(GEMINI_BASE_URL);
    expect(screen.queryByLabelText('서버 주소')).toBeNull();
    expect(screen.queryByLabelText('포트')).toBeNull();
    expect(screen.queryByRole('switch', { name: '전체 주소 직접 입력' })).toBeNull();
    value.controller.dispose();
  });

  it('Gemini에서 LM Studio / Ollama로 바꾸면 Gemini 주소를 비우고 주소·포트 칸도 비워요', async () => {
    const value = await setup({
      saved: {
        schemaVersion: 2,
        fontSize: 18,
        selection: {
          connection: { provider: 'gemini', baseUrl: GEMINI_BASE_URL, revision: 4 },
          modelId: 'generation',
          translationMode: 'stream',
        },
      },
    });

    fireEvent.click(screen.getByRole('button', { name: '제공자 Google Gemini' }));
    fireEvent.click(screen.getByRole('radio', { name: 'LM Studio / Ollama' }));

    expect(value.controller.getSnapshot().connection.baseUrl).toBe('');
    expect(screen.getByLabelText('서버 주소')).toHaveValue('');
    expect(screen.getByLabelText('포트')).toHaveValue('');
    value.controller.dispose();
  });
});

describe('OpenAI 호환 주소 조합과 해석', () => {
  it('포트 없는 주소와 끝 슬래시를 해석해요', () => {
    expect(parsePresetAddress('http://192.168.0.10/v1')).toEqual({
      host: '192.168.0.10',
      port: '',
    });
    expect(parsePresetAddress('http://192.168.0.10/v1/')).toEqual({
      host: '192.168.0.10',
      port: '',
    });
  });

  it('대문자 스킴도 해석해요', () => {
    expect(parsePresetAddress('HTTP://192.168.0.10:1234/v1')).toEqual({
      host: '192.168.0.10',
      port: '1234',
    });
  });

  it('주소·포트 형식이 아니면 null을 돌려줘요', () => {
    for (const address of [
      'https://proxy.example/api/v1',
      'http://192.168.0.10:1234/api/v1',
      'http://192.168.0.10:1234/v1?x=1',
      'http://user@192.168.0.10:1234/v1',
      'http://192.168.0.10:1234',
    ]) {
      expect(parsePresetAddress(address)).toBeNull();
    }
  });

  it('주소와 포트로 기본 주소를 만들고 주소가 비면 빈 문자열이에요', () => {
    expect(composePresetAddress(' 192.168.0.10 ', ' 1234 ')).toBe('http://192.168.0.10:1234/v1');
    expect(composePresetAddress('192.168.0.10', '')).toBe('http://192.168.0.10/v1');
    expect(composePresetAddress('   ', '1234')).toBe('');
  });
});

describe('연결 확인 결과 알림', () => {
  const baseUrl = 'http://192.0.2.1/v1';
  const messages = {
    success: '서버에 연결했어요. 번역에 쓸 수 있는 모델이 2개 있어요.',
    invalid:
      'API 주소 형식이 올바르지 않아요. http:// 또는 https://로 시작하고 /v1까지만 적어 주세요.',
    network:
      '서버에 연결하지 못했어요. 주소와 포트, 서버가 켜져 있는지, 같은 네트워크(또는 VPN)에 있는지 확인해 주세요.',
    notFound: '서버가 이 주소를 찾지 못했어요(HTTP 404). API 주소가 /v1로 끝나는지 확인해 주세요.',
    serverError: '서버 내부에서 오류가 났어요(HTTP 503). 서버 상태를 확인해 주세요.',
    authRejected: '서버가 인증값을 거부했어요(HTTP 401). 인증값을 다시 확인해 주세요.',
    badResponse: '서버 응답에서 모델 목록을 읽지 못했어요. API 주소와 제공자 설정을 확인해 주세요.',
    busy: '미리 번역 중에는 연결을 확인할 수 없어요. 번역이 끝난 뒤 다시 확인해 주세요.',
    modelList: '모델 목록을 불러오지 못했어요. 잠시 뒤 다시 확인해 주세요.',
    redirect: '서버가 다른 주소로 보내려고 했어요. 최종 API 주소를 직접 적어 주세요.',
  };
  const snackbarText = () => document.querySelector('.nr-snackbar__text')?.textContent;
  const connectionStatusText = () =>
    screen.getByRole('status').querySelector('.nr-list-item__supporting')?.textContent;
  const generation = (id: string): ModelChoice => ({
    id,
    displayName: id,
    supportsGeneration: true,
  });

  async function checkWith(catalog: NonNullable<RenewalDependencies['catalog']>) {
    const value = await setup({ catalog });
    fireEvent.change(screen.getByLabelText('서버 주소'), { target: { value: '192.0.2.1' } });
    fireEvent.click(screen.getByRole('button', { name: '연결 확인하기' }));
    return value;
  }

  async function expectFailure(message: string) {
    await waitFor(() => expect(snackbarText()).toBe(message));
    await waitFor(() => expect(connectionStatusText()).toBe(message));
  }

  it('성공하면 번역에 쓸 수 있는 생성 모델 수를 스낵바로 알려요', async () => {
    const value = await checkWith(
      vi.fn(async (connection: ConnectionConfig) => ({
        connection,
        models: [
          generation('a'),
          generation('b'),
          { ...generation('c'), supportsGeneration: false },
        ],
      })),
    );

    await waitFor(() => expect(snackbarText()).toBe(messages.success));
    value.controller.dispose();
  });

  it('주소 형식이 틀리면 정확한 안내를 스낵바와 연결 상태에 보여 줘요', async () => {
    const value = await checkWith(
      vi.fn(async () => {
        throw new ReaderError('connection');
      }),
    );

    await expectFailure(messages.invalid);
    value.controller.dispose();
  });

  it('서버에 닿지 못하면 네트워크 안내를 보여 줘요', async () => {
    const value = await checkWith(
      vi.fn(async () => {
        throw new ReaderError('timeout_unknown', 'unknown');
      }),
    );

    await expectFailure(messages.network);
    value.controller.dispose();
  });

  it('HTTP 404와 503은 상태 코드를 포함한 안내를 보여 줘요', async () => {
    const notFound = await checkWith(
      vi.fn(async () => {
        throw new ReaderError('connection', 'received', 404);
      }),
    );
    await expectFailure(messages.notFound);
    notFound.controller.dispose();
    cleanup();

    const serverError = await checkWith(
      vi.fn(async () => {
        throw new ReaderError('connection', 'received', 503);
      }),
    );
    await expectFailure(messages.serverError);
    serverError.controller.dispose();
  });

  it('응답 주소가 요청과 달라 2xx가 막히면 리다이렉트 안내를 괄호 없이 보여 줘요', async () => {
    const value = await checkWith(
      vi.fn(async () => {
        throw new ReaderError('connection', 'received', 200);
      }),
    );

    await expectFailure(messages.redirect);
    value.controller.dispose();
  });

  it('인증 거부는 상태 코드를 포함한 안내를 보여 줘요', async () => {
    const value = await checkWith(
      vi.fn(async () => {
        throw new ReaderError('auth', 'received', 401);
      }),
    );

    await expectFailure(messages.authRejected);
    value.controller.dispose();
  });

  it('인증값 저장 확인도 같은 방식으로 실패 이유를 알려요', async () => {
    const value = await setup({
      saved: savedSettings('provider.existing'),
      catalog: vi.fn(async () => {
        throw new ReaderError('auth', 'received', 401);
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: '변경' }));
    fireEvent.click(screen.getByRole('button', { name: '저장하기' }));

    await expectFailure(messages.authRejected);
    value.controller.dispose();
  });

  it('응답이 모델 목록 형식이 아니면 응답 형식 안내를 보여 줘요', async () => {
    const value = await checkWith(
      vi.fn(async () => {
        throw new ReaderError('model_list', 'received');
      }),
    );

    await expectFailure(messages.badResponse);
    value.controller.dispose();
  });

  it('확인 중 예외가 나도 스낵바로 알리고 처리되지 않은 rejection을 남기지 않아요', async () => {
    const base = createRenewalController().getSnapshot();
    const state = {
      ...base,
      connectionAvailable: true,
      connection: { ...base.connection, baseUrl },
    };
    const onCheck = vi.fn(async (): Promise<never> => {
      throw new Error('synthetic check failure');
    });
    render(
      <SnackbarProvider>
        <SettingsScreen state={state} onChange={() => {}} onCheck={onCheck} onSelect={() => {}} />
      </SnackbarProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '연결 확인하기' }));

    await waitFor(() => expect(snackbarText()).toBe(messages.modelList));
    expect(onCheck).toHaveBeenCalledTimes(1);
  });

  it('미리 번역 중이면 확인을 건너뛰고 그 이유를 스낵바로 알려요', async () => {
    const base = createRenewalController().getSnapshot();
    const state = {
      ...base,
      connectionAvailable: true,
      connection: { ...base.connection, baseUrl },
    };
    const onCheck = vi.fn(async () => ({ kind: 'skipped' as const, reason: 'busy' as const }));
    render(
      <SnackbarProvider>
        <SettingsScreen state={state} onChange={() => {}} onCheck={onCheck} onSelect={() => {}} />
      </SnackbarProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '연결 확인하기' }));

    await waitFor(() => expect(snackbarText()).toBe(messages.busy));
  });

  it('확인하는 동안 버튼 문구를 확인하는 중으로 바꾸고 끝나면 되돌려요', async () => {
    let release!: () => void;
    const catalog = vi.fn(
      (connection: ConnectionConfig) =>
        new Promise<{ connection: ConnectionConfig; models: readonly ModelChoice[] }>((resolve) => {
          release = () => resolve({ connection, models: [generation('a')] });
        }),
    );
    const value = await checkWith(catalog);

    expect(await screen.findByRole('button', { name: '확인하는 중…' })).toBeDisabled();
    await act(async () => release());

    await waitFor(() =>
      expect(screen.getByRole('button', { name: '연결 확인하기' })).toBeEnabled(),
    );
    value.controller.dispose();
  });

  it.each([
    [
      '성공',
      vi.fn(async (connection: ConnectionConfig) => ({
        connection,
        models: [generation('a'), generation('b')],
      })),
      messages.success,
    ],
    [
      '실패',
      vi.fn(async () => {
        throw new ReaderError('connection', 'received', 404);
      }),
      messages.notFound,
    ],
  ])('%s 메시지에는 주소와 인증값이 나오지 않아요', async (_label, catalog, message) => {
    const host = 'private-host.example.test';
    const canary = 'private-auth-canary';
    const value = await setup({ catalog });
    fireEvent.change(screen.getByLabelText('서버 주소'), { target: { value: host } });
    fireEvent.change(screen.getByLabelText('포트'), { target: { value: '1234' } });
    fireEvent.change(screen.getByLabelText('인증값 (선택)'), { target: { value: canary } });
    fireEvent.click(screen.getByRole('button', { name: '연결 확인하기' }));

    await waitFor(() => expect(snackbarText()).toBe(message));
    // 화면의 '완성 주소' 안내에는 주소가 보이는 게 맞으므로, 메시지 영역(스낵바·연결 상태)만 확인한다.
    expect(snackbarText()).not.toContain(host);
    expect(connectionStatusText()).not.toContain(host);
    expect(document.body.textContent).not.toContain(canary);
    value.controller.dispose();
  });
});

describe('설정 모델 행 (#176)', () => {
  const baseUrl = 'http://192.0.2.1/v1';
  const gguf = '/home/u/models/gemma-4-E4B-it-UD-Q4_K_XL.gguf';
  const readable = 'gemma-4-E4B-it-UD-Q4_K_XL';
  const snapshot = (overrides: Partial<RenewalSnapshot> = {}): RenewalSnapshot => {
    const base = createRenewalController().getSnapshot();
    return {
      ...base,
      connectionAvailable: true,
      connection: { ...base.connection, baseUrl },
      ...overrides,
    };
  };
  const ui = (state: RenewalSnapshot, onCheck: () => Promise<ConnectionCheckResult>) => (
    <SnackbarProvider>
      <SettingsScreen state={state} onChange={() => {}} onCheck={onCheck} onSelect={() => {}} />
    </SnackbarProvider>
  );
  const snackbarText = () => document.querySelector('.nr-snackbar__text')?.textContent;

  it('목록이 비어도 저장된 모델의 읽을 수 있는 이름을 보여 주고 행을 활성으로 둬요', () => {
    const onCheck = vi.fn(async (): Promise<ConnectionCheckResult> => ({ kind: 'superseded' }));
    render(ui(snapshot({ selectedModelId: gguf, models: [] }), onCheck));

    expect(screen.getByRole('button', { name: `모델 ${readable}` })).toBeEnabled();
  });

  it('Windows 경로 모델 ID도 마지막 조각을 이름으로 보여 줘요', () => {
    const onCheck = vi.fn(async (): Promise<ConnectionCheckResult> => ({ kind: 'superseded' }));
    render(
      ui(snapshot({ selectedModelId: 'C:\\models\\qwen3-8b-Q4_K_M.gguf', models: [] }), onCheck),
    );

    expect(screen.getByRole('button', { name: '모델 qwen3-8b-Q4_K_M' })).toBeEnabled();
  });

  it('목록 없이 행을 누르면 연결을 한 번 확인하고 생성 모델이 오면 모델 선택 창을 열어요', async () => {
    const onCheck = vi.fn(async (): Promise<ConnectionCheckResult> => ({
      kind: 'done',
      status: 'connected',
      modelCount: 1,
      problem: null,
    }));
    const view = render(ui(snapshot({ selectedModelId: gguf, models: [] }), onCheck));

    fireEvent.click(screen.getByRole('button', { name: `모델 ${readable}` }));

    expect(onCheck).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: '모델 선택' })).not.toBeInTheDocument();
    view.rerender(
      ui(
        snapshot({
          selectedModelId: gguf,
          catalogStatus: 'connected',
          models: [{ id: gguf, displayName: readable, supportsGeneration: true }],
        }),
        onCheck,
      ),
    );
    expect(await screen.findByRole('dialog', { name: '모델 선택' })).toBeVisible();
  });

  it('연결 확인이 실패해 목록이 계속 비면 모델 선택 창을 열지 않고 실패를 알려요', async () => {
    const onCheck = vi.fn(async (): Promise<ConnectionCheckResult> => {
      throw new Error('synthetic check failure');
    });
    const view = render(ui(snapshot({ selectedModelId: gguf, models: [] }), onCheck));

    fireEvent.click(screen.getByRole('button', { name: `모델 ${readable}` }));

    await waitFor(() =>
      expect(snackbarText()).toBe('모델 목록을 불러오지 못했어요. 잠시 뒤 다시 확인해 주세요.'),
    );
    view.rerender(
      ui(snapshot({ selectedModelId: gguf, catalogStatus: 'connection', models: [] }), onCheck),
    );
    expect(screen.queryByRole('dialog', { name: '모델 선택' })).not.toBeInTheDocument();
  });

  it('목록에 표시 이름이 있으면 파일 경로 대신 그 이름을 써요', () => {
    render(
      ui(
        snapshot({
          selectedModelId: gguf,
          catalogStatus: 'connected',
          models: [{ id: gguf, displayName: '보기 좋은 이름', supportsGeneration: true }],
        }),
        vi.fn(async (): Promise<ConnectionCheckResult> => ({ kind: 'superseded' })),
      ),
    );

    expect(screen.getByRole('button', { name: '모델 보기 좋은 이름' })).toBeEnabled();
  });

  it('선택한 모델도 목록도 없으면 모델 행을 비활성으로 둬요', () => {
    render(
      ui(
        snapshot({ selectedModelId: null, models: [] }),
        vi.fn(async (): Promise<ConnectionCheckResult> => ({ kind: 'superseded' })),
      ),
    );

    expect(screen.getByRole('button', { name: '모델 선택 전' })).toBeDisabled();
  });
});

describe('번역 전 용어집 자동 생성 스위치 (#192)', () => {
  function settingsState(provider: ConnectionConfig['provider']): RenewalSnapshot {
    const state = createRenewalController().getSnapshot();
    return { ...state, connection: { ...state.connection, provider } };
  }

  it('OpenAI 호환 서버에서 켜진 상태로 보이고 누르면 끄기를 알려요', () => {
    const onAutoGlossary = vi.fn();
    render(
      <SettingsScreen
        state={settingsState('openai-compatible')}
        onChange={() => {}}
        onCheck={async () => ({ kind: 'superseded' as const })}
        onSelect={() => {}}
        onAutoRetryFailed={() => {}}
        onAutoGlossary={onAutoGlossary}
      />,
    );

    const toggle = screen.getByRole('switch', { name: '번역 전 용어집 자동 생성' });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(onAutoGlossary).toHaveBeenCalledWith(false);
  });

  it('Gemini에서는 용어집 스위치를 보여 주지 않아요', () => {
    render(
      <SettingsScreen
        state={settingsState('gemini')}
        onChange={() => {}}
        onCheck={async () => ({ kind: 'superseded' as const })}
        onSelect={() => {}}
        onAutoRetryFailed={() => {}}
        onAutoGlossary={() => {}}
      />,
    );

    expect(
      screen.queryByRole('switch', { name: '번역 전 용어집 자동 생성' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: '실패한 문단 자동으로 다시 번역' }),
    ).toBeInTheDocument();
  });
});

describe('정밀스캔 외부 조회 설정 (#203)', () => {
  const WIKI_SWITCH = '위키백과·위키데이터에서 찾아보기';
  const NAMU_SWITCH = '나무위키에서 찾아보기';

  function scanState(
    overrides: Partial<RenewalSnapshot> = {},
    provider: ConnectionConfig['provider'] = 'openai-compatible',
  ): RenewalSnapshot {
    const state = createRenewalController().getSnapshot();
    return {
      ...state,
      termScanAvailable: true,
      connection: { ...state.connection, provider },
      ...overrides,
    };
  }

  function renderSettings(
    state: RenewalSnapshot,
    onLookupWikipedia = vi.fn(),
    onLookupNamuwiki = vi.fn(),
  ) {
    render(
      <SettingsScreen
        state={state}
        onChange={() => {}}
        onCheck={async () => ({ kind: 'superseded' as const })}
        onSelect={() => {}}
        onAutoRetryFailed={() => {}}
        onLookupWikipedia={onLookupWikipedia}
        onLookupNamuwiki={onLookupNamuwiki}
      />,
    );
    return { onLookupWikipedia, onLookupNamuwiki };
  }

  it('정밀스캔이 가능한 OpenAI 호환 서버에서만 조회 섹션을 보여 준다', () => {
    renderSettings(scanState());
    expect(screen.getByRole('heading', { name: '용어 정밀스캔' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: WIKI_SWITCH })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: NAMU_SWITCH })).not.toBeChecked();
    cleanup();

    renderSettings(scanState({ termScanAvailable: false }));
    expect(screen.queryByRole('switch', { name: WIKI_SWITCH })).not.toBeInTheDocument();
    cleanup();

    renderSettings(scanState({}, 'gemini'));
    expect(screen.queryByRole('switch', { name: NAMU_SWITCH })).not.toBeInTheDocument();
  });

  it('끈 조회를 켜면 확인 대화상자를 열고 켜기를 누를 때만 켠다', () => {
    const { onLookupWikipedia } = renderSettings(scanState());
    fireEvent.click(screen.getByRole('switch', { name: WIKI_SWITCH }));
    expect(onLookupWikipedia).not.toHaveBeenCalled();
    expect(screen.getByText('위키백과·위키데이터 조회를 켤까요?')).toBeVisible();
    expect(
      screen.getByText(
        '용어 정밀스캔을 실행할 때 일본어 용어 이름을 ja.wikipedia.org와 www.wikidata.org에 보내요. 회차 본문과 번역문은 보내지 않아요.',
      ),
    ).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(onLookupWikipedia).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('switch', { name: WIKI_SWITCH }));
    fireEvent.click(screen.getByRole('button', { name: '켜기' }));
    expect(onLookupWikipedia).toHaveBeenCalledTimes(1);
    expect(onLookupWikipedia).toHaveBeenCalledWith(true);
  });

  it('나무위키 조회도 같은 확인을 거치고 끌 때는 확인 없이 바로 끈다', () => {
    const { onLookupNamuwiki } = renderSettings(scanState({ lookupNamuwiki: true }));
    expect(screen.getByRole('switch', { name: NAMU_SWITCH })).toBeChecked();

    fireEvent.click(screen.getByRole('switch', { name: NAMU_SWITCH }));
    expect(onLookupNamuwiki).toHaveBeenCalledWith(false);
    expect(screen.queryByText('나무위키 조회를 켤까요?')).toBeNull();
    cleanup();

    const next = renderSettings(scanState());
    fireEvent.click(screen.getByRole('switch', { name: NAMU_SWITCH }));
    expect(screen.getByText('나무위키 조회를 켤까요?')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '켜기' }));
    expect(next.onLookupNamuwiki).toHaveBeenCalledWith(true);
  });
});

describe('백업 설정 섹션(#269)', () => {
  const EXPORT_ROW =
    '백업 파일 만들기 서재·저장한 번역·용어집·읽기 위치·설정을 파일 하나로 저장해요.';
  const RESTORE_ROW = '백업에서 복원하기 다른 기기나 이전 앱에서 만든 백업 파일을 불러와요.';

  function renderBackup(
    options: {
      readonly available?: boolean;
      readonly locked?: boolean;
      readonly onExport?: () => Promise<BackupResult>;
      readonly onRestore?: () => Promise<BackupResult>;
      readonly withBackup?: boolean;
    } = {},
  ) {
    const onExport = vi.fn(
      options.onExport ?? (async (): Promise<BackupResult> => ({ kind: 'cancelled' })),
    );
    const onRestore = vi.fn(
      options.onRestore ?? (async (): Promise<BackupResult> => ({ kind: 'cancelled' })),
    );
    const onReload = vi.fn();
    render(
      <SettingsScreen
        state={createRenewalController().getSnapshot()}
        onChange={() => {}}
        onCheck={async () => ({ kind: 'superseded' as const })}
        onSelect={() => {}}
        onReload={onReload}
        backup={
          options.withBackup === false
            ? undefined
            : {
                available: options.available ?? true,
                locked: options.locked ?? false,
                onExport,
                onRestore,
              }
        }
      />,
    );
    return { onExport, onRestore, onReload };
  }

  it('쓸 수 있을 때만 백업 제목·두 항목·API 키 안내를 정보 앞에 보여 줘요', () => {
    renderBackup();
    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent);
    expect(headings.indexOf('백업')).toBeGreaterThan(-1);
    expect(headings.indexOf('백업')).toBeLessThan(headings.indexOf('정보'));
    expect(screen.getByRole('button', { name: EXPORT_ROW })).toBeEnabled();
    expect(screen.getByRole('button', { name: RESTORE_ROW })).toBeEnabled();
    expect(
      screen.getByText(
        'API 키와 기기 판정 모델은 백업에 넣지 않아요. 복원한 뒤 다시 입력하거나 내려받아 주세요.',
      ),
    ).toBeVisible();
    expect(screen.queryByText('번역이나 스캔이 끝난 뒤에 백업할 수 있어요.')).toBeNull();
    cleanup();

    renderBackup({ available: false });
    expect(screen.queryByRole('heading', { name: '백업' })).toBeNull();
    cleanup();

    renderBackup({ withBackup: false });
    expect(screen.queryByRole('heading', { name: '백업' })).toBeNull();
    expect(screen.queryByRole('button', { name: EXPORT_ROW })).toBeNull();
  });

  it('백업 파일 만들기는 저장하면 담은 파일 수를 알려 주고 취소하면 조용해요', async () => {
    const saved = renderBackup({ onExport: async () => ({ kind: 'saved', files: 12 }) });
    fireEvent.click(screen.getByRole('button', { name: EXPORT_ROW }));
    expect(saved.onExport).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('백업 파일을 저장했어요. 파일 12개를 담았어요.')).toBeVisible();
    expect(screen.getByRole('button', { name: EXPORT_ROW })).toBeEnabled();
    cleanup();

    const cancelled = renderBackup({ onExport: async () => ({ kind: 'cancelled' }) });
    fireEvent.click(screen.getByRole('button', { name: EXPORT_ROW }));
    await waitFor(() => expect(cancelled.onExport).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: EXPORT_ROW })).toBeEnabled());
    expect(screen.queryByText(/백업 파일을 저장|만들지 못했어요/)).toBeNull();
  });

  it('만들기에 실패하면 저장 공간을 확인하라고 알려요', async () => {
    renderBackup({ onExport: async () => ({ kind: 'failed' }) });
    fireEvent.click(screen.getByRole('button', { name: EXPORT_ROW }));
    expect(
      await screen.findByText('백업 파일을 만들지 못했어요. 저장 공간을 확인해 주세요.'),
    ).toBeVisible();
  });

  it('진행하는 동안에는 두 항목이 막혀요', async () => {
    let finish: (value: BackupResult) => void = () => {};
    const { onExport } = renderBackup({
      onExport: () => new Promise<BackupResult>((resolve) => (finish = resolve)),
    });
    fireEvent.click(screen.getByRole('button', { name: EXPORT_ROW }));
    expect(screen.getByRole('button', { name: EXPORT_ROW })).toBeDisabled();
    expect(screen.getByRole('button', { name: RESTORE_ROW })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: EXPORT_ROW }));
    expect(onExport).toHaveBeenCalledTimes(1);
    finish({ kind: 'saved', files: 1 });
    await waitFor(() => expect(screen.getByRole('button', { name: EXPORT_ROW })).toBeEnabled());
  });

  it('복원은 확인 창에서 파일 고르기를 눌러야 시작하고 취소하면 아무 일도 없어요', async () => {
    const { onRestore } = renderBackup({ onRestore: async () => ({ kind: 'invalid' }) });
    fireEvent.click(screen.getByRole('button', { name: RESTORE_ROW }));
    expect(screen.getByText('백업으로 바꿀까요?')).toBeVisible();
    expect(
      screen.getByText(
        '지금 기기의 서재·번역·용어집·설정이 백업 파일 내용으로 바뀌어요. 지금 데이터는 지워져요.',
      ),
    ).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(onRestore).not.toHaveBeenCalled();
    expect(screen.queryByText('백업으로 바꿀까요?')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: RESTORE_ROW }));
    fireEvent.click(screen.getByRole('button', { name: '파일 고르기' }));
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('백업으로 바꿀까요?')).toBeNull();
    expect(
      await screen.findByText('이 앱의 백업 파일이 아니에요. 파일을 다시 골라 주세요.'),
    ).toBeVisible();
  });

  it('복원에 실패하면 지금 데이터가 그대로라고 알리고 앱을 다시 불러오지 않아요', async () => {
    vi.useFakeTimers();
    try {
      const { onReload } = renderBackup({ onRestore: async () => ({ kind: 'failed' }) });
      fireEvent.click(screen.getByRole('button', { name: RESTORE_ROW }));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '파일 고르기' }));
      });
      expect(screen.getByText('복원하지 못했어요. 지금 데이터는 그대로예요.')).toBeVisible();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(onReload).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('잠겨 있으면 두 항목을 눌러도 아무 일도 없고 잠금 문구를 보여 줘요', () => {
    const { onExport, onRestore } = renderBackup({ locked: true });
    expect(screen.getByText('번역이나 스캔이 끝난 뒤에 백업할 수 있어요.')).toBeVisible();
    expect(screen.getByRole('button', { name: EXPORT_ROW })).toBeDisabled();
    expect(screen.getByRole('button', { name: RESTORE_ROW })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: EXPORT_ROW }));
    fireEvent.click(screen.getByRole('button', { name: RESTORE_ROW }));
    expect(screen.queryByText('백업으로 바꿀까요?')).toBeNull();
    expect(onExport).not.toHaveBeenCalled();
    expect(onRestore).not.toHaveBeenCalled();
  });

  it('복원하면 안내를 보여 주고 1초 뒤 앱을 다시 불러오며 그동안 항목을 막아요', async () => {
    vi.useFakeTimers();
    try {
      const { onReload } = renderBackup({
        onRestore: async () => ({ kind: 'restored', files: 3 }),
      });
      fireEvent.click(screen.getByRole('button', { name: RESTORE_ROW }));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '파일 고르기' }));
      });
      expect(screen.getByText('복원했어요. 앱을 다시 불러올게요.')).toBeVisible();
      expect(screen.getByRole('button', { name: EXPORT_ROW })).toBeDisabled();
      expect(screen.getByRole('button', { name: RESTORE_ROW })).toBeDisabled();
      expect(onReload).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(999);
      });
      expect(onReload).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(onReload).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('앱 화면은 주입한 백업 기능을 설정에 연결해요', async () => {
    const backup: BackupPlatform = {
      available: () => true,
      exportBackup: vi.fn(async (): Promise<BackupResult> => ({ kind: 'saved', files: 4 })),
      restoreBackup: vi.fn(async (): Promise<BackupResult> => ({ kind: 'cancelled' })),
    };
    const controller = createRenewalController({
      settings: {
        readReadingSettings: vi.fn(async () => savedSettings()),
        saveReadingSettings: vi.fn(async () => {}),
      },
    });
    render(<Application controller={controller} platform={platform()} backup={backup} />);
    act(() => controller.navigate({ kind: 'settings' }));
    await screen.findByRole('heading', { level: 1, name: '설정' });
    fireEvent.click(screen.getByRole('button', { name: EXPORT_ROW }));
    expect(await screen.findByText('백업 파일을 저장했어요. 파일 4개를 담았어요.')).toBeVisible();
    expect(backup.exportBackup).toHaveBeenCalledTimes(1);
  });
});
