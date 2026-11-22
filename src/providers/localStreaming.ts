import {
  ReaderError,
  type ModelTransport,
  type SelectedModel,
  type WholeChapterRequest,
  type WholeChapterResult,
} from '../contracts';
import { createOpenAIStream } from './openaiStream';
import { translateParagraphs } from './paragraphTranslation';

export { streamingLimits } from './paragraphTranslation';

export async function translateLocalStream(
  request: WholeChapterRequest,
  selection: SelectedModel,
  transport: ModelTransport,
  url: string,
  authorization: string | undefined,
  signal: AbortSignal,
): Promise<WholeChapterResult> {
  const streamPost = transport.streamPost?.bind(transport);
  if (!streamPost) throw new ReaderError('connection', 'not_sent');
  return translateParagraphs(
    request,
    selection,
    async (messages, maxTokens, onPreview, signal) => {
      const parser = createOpenAIStream(onPreview);
      let response;
      try {
        response = await streamPost(
          {
            url,
            body: {
              model: selection.modelId,
              messages,
              stream: true,
              max_tokens: maxTokens,
              reasoning_effort: 'none',
            },
            ...(authorization ? { authorization } : {}),
          },
          signal,
          parser.push,
        );
      } catch (error) {
        if (error instanceof ReaderError) throw error;
        throw new ReaderError(signal.aborted ? 'cancelled' : 'timeout_unknown', 'unknown');
      }
      if (signal.aborted) throw new ReaderError('cancelled', 'unknown');
      if (response.status === 401 || response.status === 403)
        throw new ReaderError('auth', 'received', response.status);
      if (response.status < 200 || response.status >= 300)
        throw new ReaderError('connection', 'received', response.status);
      // The final raw frames also cover listener events queued after native settlement.
      const final = createOpenAIStream(() => {});
      final.push(String(response.data));
      try {
        return final.complete();
      } catch {
        // Received malformed output can be retried by paragraph validation.
        return undefined;
      }
    },
    signal,
  );
}
