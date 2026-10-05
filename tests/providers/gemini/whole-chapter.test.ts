import { describe, expect, it } from 'vitest';
import type {
  ModelRequest,
  ModelTransport,
  SecretStore,
  SelectedModel,
  WholeChapterRequest,
} from '../../../src/contracts';
import { GEMINI_BASE_URL } from '../../../src/providers/gemini';
import {
  createGeminiProviderSession,
  listGeminiModels,
} from '../../../src/providers/gemini/wholeChapter';
import { source } from '../wholeChapterFixture';

const request: WholeChapterRequest = {
  source,
  token: { requestId: 'request', chapterId: source.chapterId, settingsRevision: 1 },
  languageDirection: 'ja-ko',
  contractVersion: 'plain-v1',
  promptVersion: 'hymt2-ko-v1',
};
const selection: SelectedModel = {
  connection: {
    provider: 'gemini',
    baseUrl: GEMINI_BASE_URL,
    authRef: 'provider.gemini-test',
    revision: 1,
  },
  modelId: 'gemini-synthetic',
};
const secrets: SecretStore = {
  get: async () => 'synthetic-gemini-key',
  set: async () => {},
  remove: async () => {},
};
const signal = (): AbortSignal => new AbortController().signal;

function sessionTransport(data: unknown, posts: ModelRequest[]): ModelTransport {
  return {
    get: async () => {
      throw new Error('Catalog is not used by this fixture');
    },
    post: async (input) => {
      posts.push(input);
      return { status: 200, headers: {}, data, url: input.url };
    },
  };
}

describe('renewal Gemini whole-chapter provider', () => {
  it('requires an explicit Gemini selection', () => {
    expect(() =>
      createGeminiProviderSession(
        {
          ...selection,
          connection: {
            provider: 'openai-compatible',
            baseUrl: 'http://127.0.0.1:1234/v1',
            revision: 1,
          },
        },
        sessionTransport({}, []),
        secrets,
      ),
    ).toThrow();
  });

  it('sends one plain-text Gemini generation with a header-only key', async () => {
    const posts: ModelRequest[] = [];
    const result = await createGeminiProviderSession(
      selection,
      sessionTransport(
        { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '한국어 번역' }] } }] },
        posts,
      ),
      secrets,
    ).translateChapter(request, signal());

    expect(result).toEqual({ text: '한국어 번역', finishReason: 'complete' });
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      url: `${GEMINI_BASE_URL}/models/gemini-synthetic:generateContent`,
      geminiApiKey: 'synthetic-gemini-key',
      body: {
        contents: [{ role: 'user', parts: [{ text: '基底《よみ》\n一\n\n\n\n二' }] }],
        generationConfig: { candidateCount: 1 },
      },
    });
    expect(posts[0]).not.toHaveProperty('authorization');
    expect(posts[0]?.body).not.toHaveProperty('responseFormat');
    expect(posts[0]?.body).not.toHaveProperty('responseSchema');
    expect(posts[0]?.body.generationConfig).not.toHaveProperty('responseFormat');
    expect(posts[0]?.body.generationConfig).not.toHaveProperty('responseSchema');
  });

  it.each([
    ['MAX_TOKENS', 'length'],
    ['SAFETY', 'blocked'],
    ['OTHER', 'unknown'],
  ])('maps %s without accepting partial text', async (finishReason, expected) => {
    const posts: ModelRequest[] = [];
    await expect(
      createGeminiProviderSession(
        selection,
        sessionTransport(
          { candidates: [{ finishReason, content: { parts: [{ text: '부분 결과' }] } }] },
          posts,
        ),
        secrets,
      ).translateChapter(request, signal()),
    ).resolves.toEqual({ text: '', finishReason: expected });
    expect(posts).toHaveLength(1);
  });

  it('lists only Gemini models that support generateContent', async () => {
    const gets: Array<{ url: string; authorization?: string; geminiApiKey?: string }> = [];
    const transport: ModelTransport = {
      get: async (input) => {
        gets.push(input);
        return {
          status: 200,
          headers: {},
          url: input.url,
          data: {
            models: [
              {
                name: 'models/gemini-synthetic',
                displayName: 'Gemini Synthetic',
                supportedGenerationMethods: ['generateContent', 'countTokens'],
              },
              {
                name: 'models/embedding-synthetic',
                displayName: 'Embedding Synthetic',
                supportedGenerationMethods: ['embedContent'],
              },
            ],
          },
        };
      },
      post: async () => {
        throw new Error('Generation is not used by this fixture');
      },
    };

    await expect(
      listGeminiModels(selection.connection, transport, secrets, signal()),
    ).resolves.toEqual([
      { id: 'gemini-synthetic', displayName: 'Gemini Synthetic', supportsGeneration: true },
    ]);
    expect(gets).toEqual([
      { url: `${GEMINI_BASE_URL}/models`, geminiApiKey: 'synthetic-gemini-key' },
    ]);
  });
});
