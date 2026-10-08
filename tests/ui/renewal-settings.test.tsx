// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Application } from '../../src/app/Application';
import { createRenewalController, type RenewalDependencies } from '../../src/app/renewalController';
import { ReaderError } from '../../src/contracts';
import type { ConnectionConfig, ModelChoice } from '../../src/contracts/reading';
import { GEMINI_BASE_URL } from '../../src/providers/gemini';
import type { ShellPlatform } from '../../src/platform/shell';
import type { ReadingSettings } from '../../src/storage/settings';
import { SettingsScreen } from '../../src/ui/SettingsScreen';
import { SnackbarProvider } from '../../src/ui/components/Snackbar';

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
    expect(screen.getByText('웹 미리보기 0.1.0')).toBeVisible();
    expect(screen.queryByRole('button', { name: '버전' })).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: '오픈소스 라이선스 THIRD_PARTY_NOTICES.md · android/NOTICE',
      }),
    ).toHaveTextContent('THIRD_PARTY_NOTICES.md · android/NOTICE');
    expect(screen.getByText('아직 기록이 없어요')).toBeVisible();
    expect(screen.queryByRole('button', { name: '최근 번역 시간' })).not.toBeInTheDocument();
    expect(document.querySelector('details')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', {
        name: '오픈소스 라이선스 THIRD_PARTY_NOTICES.md · android/NOTICE',
      }),
    );
    expect(screen.getByRole('dialog', { name: '오픈소스 라이선스' })).not.toHaveTextContent(
      'Android scaffold',
    );
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

    expect(screen.getAllByRole('switch')).toHaveLength(2);
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
    fireEvent.change(screen.getByLabelText('API 기본 주소'), {
      target: { value: 'http://192.0.2.1/v1' },
    });
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
    fireEvent.change(screen.getByLabelText('API 기본 주소'), { target: { value: '' } });

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
  };
  const snackbarText = () => document.querySelector('.nr-snackbar__text')?.textContent;
  const connectionStatusText = () =>
    screen.getByRole('status').querySelector('.nr-list-item__supporting')?.textContent;
  const generation = (id: string): ModelChoice => ({
    id,
    displayName: id,
    supportsGeneration: true,
  });

  async function checkWith(
    catalog: NonNullable<RenewalDependencies['catalog']>,
    address = baseUrl,
  ) {
    const value = await setup({ catalog });
    fireEvent.change(screen.getByLabelText('API 기본 주소'), { target: { value: address } });
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
    fireEvent.change(screen.getByLabelText('API 기본 주소'), {
      target: { value: `http://${host}:1234/v1` },
    });
    fireEvent.change(screen.getByLabelText('인증값 (선택)'), { target: { value: canary } });
    fireEvent.click(screen.getByRole('button', { name: '연결 확인하기' }));

    await waitFor(() => expect(snackbarText()).toBe(message));
    expect(document.body.textContent).not.toContain(host);
    expect(document.body.textContent).not.toContain(canary);
    value.controller.dispose();
  });
});
