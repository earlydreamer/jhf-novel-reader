import { ReaderError } from '../contracts';
/** SSE is framed independently of network reads, JSON and UTF-8 byte boundaries. */
export function createOpenAIStream(onText: (text: string) => void) {
  let buffer = '',
    text = '',
    finish: unknown = null,
    ended = false;
  function frame(value: string) {
    const data = value
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) return;
    if (ended) throw new ReaderError('invalid_output', 'received');
    if (data === '[DONE]') {
      ended = true;
      return;
    }
    let valueJson: unknown;
    try {
      valueJson = JSON.parse(data);
    } catch {
      throw new ReaderError('invalid_output', 'received');
    }
    const valueObject = valueJson as {
      error?: unknown;
      choices?: {
        index?: number;
        delta?: {
          content?: unknown;
          refusal?: unknown;
          tool_calls?: unknown;
          function_call?: unknown;
        };
        finish_reason?: unknown;
      }[];
    };
    if (!valueObject || valueObject.error || !Array.isArray(valueObject.choices))
      throw new ReaderError('invalid_output', 'received');
    if (!valueObject.choices.length) return; // optional usage-only event
    if (valueObject.choices.length !== 1) throw new ReaderError('invalid_output', 'received');
    const choice = valueObject.choices[0]!;
    if (choice.index !== undefined && choice.index !== 0)
      throw new ReaderError('invalid_output', 'received');
    const delta = choice.delta;
    if (
      delta?.refusal ||
      delta?.function_call ||
      (delta?.tool_calls !== undefined &&
        (!Array.isArray(delta.tool_calls) || delta.tool_calls.length))
    )
      throw new ReaderError('invalid_output', 'received');
    if (delta?.content !== undefined && delta.content !== null) {
      if (typeof delta.content !== 'string' || finish !== null)
        throw new ReaderError('invalid_output', 'received');
      text += delta.content;
      if (text.length > 4_000_000) throw new ReaderError('invalid_output', 'received');
      onText(text);
    }
    if (choice.finish_reason !== undefined && choice.finish_reason !== null)
      finish = choice.finish_reason;
  }
  return {
    push(chunk: string) {
      buffer += chunk;
      if (buffer.length > 1_000_000) throw new ReaderError('invalid_output', 'received');
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        frame(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
      }
    },
    complete() {
      if (buffer.trim()) frame(buffer);
      if (!ended || !['stop', 'length', 'content_filter'].includes(String(finish)))
        throw new ReaderError('invalid_output', 'received');
      return {
        text,
        finishReason:
          finish === 'stop'
            ? ('complete' as const)
            : finish === 'length'
              ? ('length' as const)
              : ('blocked' as const),
      };
    },
  };
}
