import { ReaderError } from '../contracts';

/** Frame SSE data independently of transport chunk boundaries. */
export function createSseReader(onData: (data: string) => void) {
  let buffer = '';
  function frame(value: string) {
    const data = value
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (data) onData(data);
  }
  return {
    push(chunk: string) {
      buffer += chunk;
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const frameLength = boundary.index + boundary[0].length;
        if (frameLength > 1_000_000) throw new ReaderError('invalid_output', 'received');
        frame(buffer.slice(0, boundary.index));
        buffer = buffer.slice(frameLength);
      }
      if (buffer.length > 1_000_000) throw new ReaderError('invalid_output', 'received');
    },
    get pending() {
      return Boolean(buffer.trim());
    },
    flush() {
      if (buffer.trim()) frame(buffer);
      buffer = '';
    },
  };
}
