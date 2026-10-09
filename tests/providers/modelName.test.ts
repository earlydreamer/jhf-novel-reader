import { expect, test } from 'vitest';
import { readableModelName } from '../../src/providers/modelName';

test('readableModelName_strips_directories_and_model_extensions', () => {
  expect(readableModelName('/a/b/x.gguf')).toBe('x');
  expect(readableModelName('C:\\m\\y.safetensors')).toBe('y');
  expect(readableModelName('publisher/model-name')).toBe('model-name');
  expect(readableModelName('plain')).toBe('plain');
  expect(readableModelName('a/b/')).toBe('b');
});
