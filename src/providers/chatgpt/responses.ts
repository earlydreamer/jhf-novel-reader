import { ReaderError, type WholeChapterResult } from '../../contracts';
import { chatGptHttpError } from './index';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const MAX_TEXT = 262_144;

/** 완료된 assistant 메시지 항목의 output_text만 이어 붙인다. 추론 항목은 버린다. */
function assistantText(item: unknown): string {
  if (!object(item) || item.type !== 'message' || item.role !== 'assistant') return '';
  if (!Array.isArray(item.content)) throw new ReaderError('invalid_output', 'received');
  let text = '';
  for (const part of item.content) {
    if (object(part) && part.type === 'output_text' && typeof part.text === 'string')
      text += part.text;
  }
  return text;
}

/** response.failed·error 이벤트의 공식 코드. 모르는 코드는 응답을 확인하지 못한 것으로 본다. */
function failure(frame: Record<string, unknown>): ReaderError {
  const response = object(frame.response) ? frame.response : undefined;
  const error = object(response?.error) ? response.error : object(frame.error) ? frame.error : {};
  const code = typeof error.code === 'string' ? error.code : undefined;
  if (!code) return new ReaderError('invalid_output', 'received');
  const mapped = chatGptHttpError(0, { error: { code } });
  return mapped.code === 'connection' || mapped.code === 'auth'
    ? new ReaderError('invalid_output', 'received')
    : new ReaderError(mapped.code, 'received');
}

/**
 * Responses SSE. 도착한 delta로 미리보기만 갱신하고, response.completed의 최종 assistant 텍스트를 확인해야 완료다.
 * 완료 이벤트의 output이 비어 있으면 같은 응답의 끝난 출력 항목을 쓴다. delta나 EOF를 완료로 올리지 않는다.
 */
export function createResponsesStream(onPreview?: (text: string) => void) {
  let buffer = '';
  let data: string[] = [];
  let preview = '';
  let responseId: string | undefined;
  const added = new Map<number, Record<string, unknown>>();
  const done = new Map<number, Record<string, unknown>>();
  let result: WholeChapterResult | undefined;

  function dispatch(payload: string) {
    if (result) return;
    let frame: unknown;
    try {
      frame = JSON.parse(payload) as unknown;
    } catch {
      throw new ReaderError('invalid_output', 'received');
    }
    if (!object(frame) || typeof frame.type !== 'string')
      throw new ReaderError('invalid_output', 'received');
    switch (frame.type) {
      case 'response.created': {
        const response = object(frame.response) ? frame.response : {};
        if (responseId !== undefined || typeof response.id !== 'string')
          throw new ReaderError('invalid_output', 'received');
        responseId = response.id;
        return;
      }
      case 'response.output_item.added':
      case 'response.output_item.done': {
        const index = frame.output_index;
        if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 255)
          throw new ReaderError('invalid_output', 'received');
        if (!object(frame.item)) throw new ReaderError('invalid_output', 'received');
        if (frame.type === 'response.output_item.added') {
          if (added.has(index)) throw new ReaderError('invalid_output', 'received');
          added.set(index, frame.item);
        } else {
          const first = added.get(index);
          if (
            !first ||
            done.has(index) ||
            first.id !== frame.item.id ||
            first.type !== frame.item.type ||
            first.role !== frame.item.role
          )
            throw new ReaderError('invalid_output', 'received');
          done.set(index, frame.item);
        }
        return;
      }
      case 'response.output_text.delta':
        if (typeof frame.delta !== 'string') throw new ReaderError('invalid_output', 'received');
        preview += frame.delta;
        if (preview.length > MAX_TEXT) throw new ReaderError('output_limit', 'received');
        onPreview?.(preview);
        return;
      case 'response.failed':
      case 'error':
        throw failure(frame);
      case 'response.incomplete': {
        const response = object(frame.response) ? frame.response : {};
        const details = object(response.incomplete_details) ? response.incomplete_details : {};
        result = {
          text: '',
          finishReason: details.reason === 'content_filter' ? 'blocked' : 'length',
        };
        return;
      }
      case 'response.completed': {
        const response = object(frame.response) ? frame.response : {};
        if (response.status !== 'completed') throw new ReaderError('invalid_output', 'received');
        if (responseId !== undefined && response.id !== responseId)
          throw new ReaderError('invalid_output', 'received');
        const output = Array.isArray(response.output) ? response.output : [];
        let text = output.map(assistantText).join('');
        // 완료 이벤트에 최종 항목이 없으면, 같은 응답에서 열고 닫은 모든 항목이 완료됐을 때만 그 텍스트를 쓴다.
        if (!output.length && responseId !== undefined && added.size && added.size === done.size) {
          const items = [...done.entries()].sort(([a], [b]) => a - b).map(([, item]) => item);
          if (items.some((item) => item.status !== 'completed'))
            throw new ReaderError('invalid_output', 'received');
          text = items.map(assistantText).join('');
        }
        if (!text.trim() || text.length > MAX_TEXT)
          throw new ReaderError('invalid_output', 'received');
        result = { text, finishReason: 'complete' };
        return;
      }
      default:
        return;
    }
  }

  return {
    /** 네이티브가 넘긴 줄 묶음. 줄바꿈으로 끝나지 않은 마지막 줄은 다음 묶음과 합친다. */
    push(chunk: string) {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const raw of lines) {
        const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
        if (line === '') {
          if (data.length) dispatch(data.join('\n'));
          data = [];
        } else if (line.startsWith('data:')) {
          data.push(line.slice(5).trimStart());
        }
        // event:·id:·주석 줄은 data의 type으로 판정하므로 따로 쓰지 않는다.
      }
    },
    complete(): WholeChapterResult {
      if (buffer) this.push('\n');
      if (data.length) dispatch(data.join('\n'));
      data = [];
      if (!result) throw new ReaderError('invalid_output', 'received');
      return result;
    },
  };
}
