import {
  ReaderError,
  type ChatGptAccount,
  type ProviderSession,
  type SelectedModel,
  type WholeChapterResult,
} from '../../contracts';
import { translateParagraphs } from '../paragraphTranslation';
import { chatGptErrorCode, chatGptHttpError, listChatGptModels } from './index';
import { createResponsesStream } from './responses';

/** 형식 규칙은 사용자 메시지에 있다. SiwC는 system 역할 항목을 받지 않으므로 instructions로 보낸다. */
const INSTRUCTIONS =
  'You are a Japanese-to-Korean translation engine. Follow the formatting rules in the user message exactly.';

type Message = { role: 'user' | 'assistant'; content: string };
const JSON_RULE =
  'Return only one JSON value that matches the JSON Schema below. No code fences, no commentary.';

/** 서버가 받지 않는 입력을 알린 거절. 같은 본문을 다시 보내지 않고 그 입력을 뺀다. */
class Unsupported extends Error {
  constructor(readonly param: string | undefined) {
    super('unsupported_capability');
  }
}

function parseJson(text: string): unknown {
  const value = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new ReaderError('invalid_output', 'received');
  }
}

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
  // 구조화 출력을 거절한 연결에는 이 세션 동안 다시 보내지 않는다.
  let structuredOutput = true;

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
    if (response.status < 200 || response.status >= 300) {
      if (
        response.status === 400 &&
        chatGptErrorCode(response.data) === 'subscription_sharing_unsupported_capability'
      ) {
        const data = response.data;
        let param: string | undefined;
        try {
          const parsed = (typeof data === 'string' ? JSON.parse(data) : data) as {
            error?: { param?: unknown };
          };
          param = typeof parsed.error?.param === 'string' ? parsed.error.param : undefined;
        } catch {
          param = undefined;
        }
        throw new Unsupported(param);
      }
      throw chatGptHttpError(response.status, response.data);
    }
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
    /**
     * 자동 용어집·정밀스캔 판정. SiwC는 temperature·출력 상한을 받지 않으므로 보내지 않는다.
     * 구조화 출력(text.format)을 먼저 쓰고, 받지 않는다는 거절이면 스키마를 지시문에 넣어 한 번만 다시 보낸다.
     */
    async completeJson(request, signal) {
      const instructions = `${request.system}

${JSON_RULE}
${JSON.stringify(request.schema)}`;
      const base = {
        model,
        instructions,
        input: [{ role: 'user', content: request.user }],
        store: false,
        stream: true,
      };
      let result: WholeChapterResult;
      try {
        result = await respond(
          structuredOutput
            ? {
                ...base,
                text: {
                  format: {
                    type: 'json_schema',
                    name: 'result',
                    strict: true,
                    schema: request.schema,
                  },
                },
              }
            : base,
          signal,
        );
      } catch (error) {
        if (!(error instanceof Unsupported) || !structuredOutput) {
          if (error instanceof Unsupported)
            throw new ReaderError('invalid_output', 'received', 400);
          throw error;
        }
        structuredOutput = false;
        try {
          result = await respond(base, signal);
        } catch (retry) {
          if (retry instanceof Unsupported)
            throw new ReaderError('invalid_output', 'received', 400);
          throw retry;
        }
      }
      if (result.finishReason !== 'complete')
        throw new ReaderError(
          result.finishReason === 'length'
            ? 'output_limit'
            : result.finishReason === 'blocked'
              ? 'blocked'
              : 'invalid_output',
          'received',
        );
      return parseJson(result.text);
    },
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
            // 번역 본문은 지원하지 않는 입력을 넣지 않으므로 이 거절은 다시 보내지 않고 알린다.
            if (error instanceof Unsupported) throw new ReaderError('connection', 'received', 400);
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
