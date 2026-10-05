import { StorageError } from './errors';
export function check(condition: unknown): asserts condition {
  if (!condition) throw new StorageError('invalid');
}
export function record(value: unknown): asserts value is Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value));
}
export function object(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  record(value);
  check(Object.keys(value).every((key) => keys.includes(key)));
}
export function text(value: unknown): asserts value is string {
  check(typeof value === 'string' && value.trim().length > 0);
}
export function integer(value: unknown, minimum = 0): asserts value is number {
  check(typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum);
}
export function url(value: unknown, httpsOnly = false): void {
  text(value);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new StorageError('invalid');
  }
  check(
    (parsed.protocol === 'https:' || (!httpsOnly && parsed.protocol === 'http:')) &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash,
  );
}
export function snapshot<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    throw new StorageError('invalid');
  }
}
