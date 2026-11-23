import {
  ReaderError,
  type ChatGptAccount,
  type ProviderSession,
  type SelectedModel,
  type WholeChapterResult,
} from '../../contracts';
import { translateParagraphs } from '../paragraphTranslation';
import { chatGptHttpError, listChatGptModels } from './index';
import { createResponsesStream } from './responses';

/** 형식 규칙은 사용자 메시지에 있다. SiwC는 system 역할 항목을 받지 않으므로 instructions로 보낸다. */
const INSTRUCTIONS =
  'You are a Japanese-to-Korean translation engine. Follow the formatting rules in the user message exactly.';

type Message = { role: 'user' | 'assistant'; content: string };

/**
 * ChatGPT 계정 연결의 제공자 세션. Responses에 store:false·stream:true로만 보내며,
 * SiwC가 받지 않는 temperature·출력 상한·이전 응답 ID는 넣지 않는다. 토큰은 네이티브가 붙인다.
 */
export function createChatGptProviderSession(
  selection: SelectedModel,
  account: ChatGptAccount,
): ProviderSession {
  const snapshot = structuredClone(selection);
  if (
    snapshot.connection.provider !== 'chatgpt' ||
    !/^[A-Za-z0-9._:/-]{1,160}$/.test(snapshot.modelId)
  )
    throw new ReaderError('model_missing');
  const model = snapshot.modelId;

  async function respond(
    body: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
    onPreview?: (text: string) => void,
  ): Promise<WholeChapterResult> {
    const stream = createResponsesStream(onPreview);
    let streamError: unknown;
    const response = await account.respond(body, signal, (chunk) => {
      if (streamError) return;
      try {
        stream.push(chunk);
      } catch (error) {
        // 해석 오류는 응답 전체를 받은 뒤 상태 코드와 함께 판정한다.
        streamError = error;
      }
    });
    if (signal.aborted) throw new ReaderError('cancelled', 'unknown');
    if (response.status < 200 || response.status >= 300)
      throw chatGptHttpError(response.status, response.data);
    if (streamError) throw streamError;
    return stream.complete();
  }

  function body(messages: readonly Message[]): Record<string, unknown> {
    return {
      model,
      instructions: INSTRUCTIONS,
      input: messages.map(({ role, content }) => ({ role, content })),
      store: false,
      stream: true,
    };
  }

  return {
    listModels: (signal) => listChatGptModels(account, signal),
    async translateChapter(request, signal) {
      if (
        request.contractVersion !== 'plain-v1' ||
        request.languageDirection !== 'ja-ko' ||
        request.token.chapterId !== request.source.chapterId
      )
        throw new ReaderError('invalid_output');
      // 로컬 스트리밍과 같은 문단 ID 형식으로 묶어 보내고 순서·ID·필수 표기를 확인한다.
      return translateParagraphs(
        request,
        snapshot,
        async (messages, _maxOutputTokens, onPreview, signal) => {
          try {
            return await respond(body(messages), signal, onPreview);
          } catch (error) {
            // 형식이 틀린 응답은 문단 번역이 다시 요청할지 정한다. 통신·권한·한도 오류는 그대로 올린다.
            if (
              error instanceof ReaderError &&
              error.code === 'invalid_output' &&
              error.outcome === 'received'
            )
              return undefined;
            throw error;
          }
        },
        signal,
      );
    },
  };
}
