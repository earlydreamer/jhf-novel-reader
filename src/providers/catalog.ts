import { ReaderError } from '../contracts';
import type { ConnectionConfig, ModelChoice, ModelTransport, SecretStore } from '../contracts';
import { normalizeOpenAICompatibleBaseUrl } from './openai-compatible';
export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function envelope(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new ReaderError('invalid_output', 'received');
  }
}
export async function authorization(
  connection: ConnectionConfig,
  secrets: SecretStore,
  signal: AbortSignal,
): Promise<string | undefined> {
  if (signal.aborted) throw new ReaderError('cancelled');
  if (connection.authRef === undefined) return undefined;
  let secret;
  try {
    secret = await secrets.get(connection.authRef);
  } catch {
    throw new ReaderError('auth');
  }
  if (signal.aborted) throw new ReaderError('cancelled');
  if (!secret?.trim() || /[\u0000-\u0020\u007f]/.test(secret)) throw new ReaderError('auth');
  return `Bearer ${secret}`;
}
export async function listModels(
  connection: ConnectionConfig,
  transport: ModelTransport,
  secrets: SecretStore,
  signal: AbortSignal,
): Promise<readonly ModelChoice[]> {
  if (connection.provider !== 'openai-compatible') throw new ReaderError('model_list');
  const base = normalizeOpenAICompatibleBaseUrl(connection.baseUrl),
    auth = await authorization(connection, secrets, signal);
  let response;
  try {
    response = await transport.get(
      { url: `${base}/models`, ...(auth === undefined ? {} : { authorization: auth }) },
      signal,
    );
  } catch (error) {
    if (error instanceof ReaderError)
      throw new ReaderError(error.code, error.outcome, error.status);
    throw new ReaderError(signal.aborted ? 'cancelled' : 'connection');
  }
  if (signal.aborted) throw new ReaderError('cancelled');
  if (response.status === 401 || response.status === 403)
    throw new ReaderError('auth', 'received', response.status);
  if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300)
    throw new ReaderError('connection', 'received', response.status);
  let data;
  try {
    data = envelope(response.data);
  } catch {
    throw new ReaderError('model_list', 'received');
  }
  if (!object(data) || !Array.isArray(data.data) || data.error !== undefined)
    throw new ReaderError('model_list', 'received');
  const ids = new Set<string>();
  return data.data.map((model: unknown) => {
    if (!object(model) || typeof model.id !== 'string' || !model.id.trim() || ids.has(model.id))
      throw new ReaderError('model_list', 'received');
    ids.add(model.id);
    return { id: model.id, displayName: model.id, supportsGeneration: true };
  });
}
