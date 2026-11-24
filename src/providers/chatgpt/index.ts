import { ReaderError, type ChatGptAccount, type ModelChoice } from '../../contracts';

/** SiwC 플랜 사용은 이 주소로만 요청한다. 사용자가 바꿀 수 없다. */
export const CHATGPT_BASE_URL = 'https://api.openai.com/v1';
export const CHATGPT_USAGE_URL = 'https://chatgpt.com/settings/usage';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeChatGptBaseUrl(value: string): string {
  if (value.replace(/\/+$/, '') !== CHATGPT_BASE_URL) throw new ReaderError('connection');
  return CHATGPT_BASE_URL;
}

/** 오류 본문에서 네이티브가 남긴 허용 어휘의 code만 읽는다. */
export function chatGptErrorCode(data: unknown): string | undefined {
  let value = data;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }
  const error = object(value) ? value.error : undefined;
  return object(error) && typeof error.code === 'string' ? error.code : undefined;
}

/**
 * 공식 오류와 복구 기준을 따른다. 플랜 미지원·한도는 다시 보내지 않고 안내하며,
 * 다른 제공자나 API 키 과금 경로로 바꾸지 않는다.
 */
export function chatGptHttpError(status: number, data: unknown): ReaderError {
  const code = chatGptErrorCode(data);
  switch (code) {
    case 'subscription_sharing_user_not_eligible':
    case 'chatpass_v2_scope_not_authorized':
      return new ReaderError('plan_not_eligible', 'received', status);
    case 'subscription_sharing_usage_limit_exceeded':
      return new ReaderError('usage_limit', 'received', status);
    case 'subscription_sharing_invalid_user':
      return new ReaderError('reconnect_required', 'received', status);
    case 'model_not_found':
      return new ReaderError('model_unavailable', 'received', status);
    case 'context_length_exceeded':
      return new ReaderError('input_limit', 'received', status);
  }
  if (status === 401 || status === 403) return new ReaderError('auth', 'received', status);
  if (status === 429) return new ReaderError('usage_limit', 'received', status);
  if (status === 404) return new ReaderError('model_unavailable', 'received', status);
  return new ReaderError('connection', 'received', status);
}

export async function listChatGptModels(
  account: ChatGptAccount,
  signal: AbortSignal,
): Promise<readonly ModelChoice[]> {
  const response = await account.models(signal);
  if (signal.aborted) throw new ReaderError('cancelled');
  if (response.status !== 200) throw chatGptHttpError(response.status, response.data);
  const data = response.data;
  if (!object(data) || !Array.isArray(data.models)) throw new ReaderError('model_list', 'received');
  const ids = new Set<string>();
  return data.models.map((model: unknown) => {
    if (
      !object(model) ||
      typeof model.slug !== 'string' ||
      typeof model.displayName !== 'string' ||
      !/^[A-Za-z0-9._:/-]{1,160}$/.test(model.slug) ||
      ids.has(model.slug)
    )
      throw new ReaderError('model_list', 'received');
    ids.add(model.slug);
    return { id: model.slug, displayName: model.displayName, supportsGeneration: true };
  });
}
