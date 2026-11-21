import { ReaderError } from '../contracts';
import { createSseReader } from './sse';

export function createOpenAIStream(onText: (text: string) => void) {
  let text = '',
    finish: unknown = null,
    ended = false;
  const frames = createSseReader((data) => {
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
  });
  return {
    push: frames.push,
    complete() {
      frames.flush();
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
