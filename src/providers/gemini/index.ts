import { ReaderError } from '../../contracts';

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
/** Fixed Google endpoint only; never retarget a user's key to a custom proxy. */
export function normalizeGeminiBaseUrl(value: string): string {
  if (value.trim() !== GEMINI_BASE_URL && value.trim() !== GEMINI_BASE_URL + '/')
    throw new ReaderError('connection');
  return GEMINI_BASE_URL;
}
/** IDs are user-selected, not a bundled assertion that a model exists or has fixed limits. */
export function normalizeGeminiModel(value: string): string {
  const model = value.trim().replace(/^models\//, '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(model)) throw new ReaderError('connection');
  return model;
}
