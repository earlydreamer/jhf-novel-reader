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

  it('requires a streaming transport when Gemini is selected in streaming mode', async () => {
    const posts: ModelRequest[] = [];
    await expect(
      createGeminiProviderSession(
        { ...selection, translationMode: 'stream' },
        sessionTransport({}, posts),
        secrets,
      ).translateChapter(request, signal()),
    ).rejects.toMatchObject({ code: 'connection', outcome: 'not_sent' });
    expect(posts).toHaveLength(0);
  });

  it.each([
    ['gemini-3.5-flash-lite', true, 4536],
    ['gemini-2.5-pro', true, 4536],
    ['gemini-3.5-flash-lite', undefined, 440],
  ] as const)(
    'reserves thinking tokens for opted-in JSON requests on %s (%s)',
    async (modelId, reserveThinkingTokens, maxOutputTokens) => {
      const json = { items: [{ id: 'c1', target: '알베르토' }] };
      const posts: ModelRequest[] = [];
      const session = createGeminiProviderSession(
        { ...selection, modelId, translationMode: 'stream' },
        sessionTransport(
          {
            candidates: [
              { finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(json) }] } },
            ],
          },
          posts,
        ),
        secrets,
      );
      await expect(
        session.completeJson!(
          {
            system: 'judge',
            user: 'candidate',
            schema: { type: 'object' },
            maxTokens: 440,
            reserveThinkingTokens,
          },
          signal(),
        ),
      ).resolves.toEqual(json);
      expect(posts).toHaveLength(1);
      expect(posts[0]).toMatchObject({
        url: `${GEMINI_BASE_URL}/models/${modelId}:generateContent`,
        body: {
          generationConfig: {
            maxOutputTokens,
            responseMimeType: 'application/json',
            responseJsonSchema: { type: 'object' },
          },
        },
      });
      expect(posts[0]?.body.generationConfig).not.toHaveProperty('thinkingConfig');
    },
  );

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

  it.each([
    { terminal: true, expectedCalls: 3 },
    { terminal: false, expectedCalls: 2 },
  ])(
    'handles an empty paragraph batch with terminal=$terminal',
    async ({ terminal, expectedCalls }) => {
      const posts: ModelRequest[] = [];
      const transport: ModelTransport = {
        ...sessionTransport({}, posts),
        streamPost: async (input) => {
          posts.push(input);
          const prompt = (input.body.contents as { parts: { text: string }[] }[]).at(-1)!.parts[0]!
            .text;
          const ids = [...prompt.matchAll(/<p id="([A-Za-z]+)">/g)].map((m) => m[1]);
          const text =
            '<main>' + ids.map((id) => `<p id="${id}">번역${id}</p>`).join('') + '</main>';
          const empty = posts.length === 2;
          const candidate = empty
            ? terminal
              ? { finishReason: 'STOP' }
              : { content: { parts: [{ text: '' }] } }
            : { finishReason: 'STOP', content: { parts: [{ text }] } };
          return {
            status: 200,
            headers: {},
            url: input.url,
            data: `data: ${JSON.stringify({ candidates: [candidate] })}\n\n`,
          };
        },
      };
      const provider = createGeminiProviderSession(
        { ...selection, translationMode: 'stream' },
        transport,
        secrets,
      );
      const result = provider.translateChapter(
        {
          ...request,
          source: {
            ...source,
            paragraphs: Array.from({ length: 9 }, (_, i) => ({
              id: `p${i}`,
              text: '夏の朝。',
              ruby: [],
            })),
          },
          reference: () => '용어집',
        },
        signal(),
      );
      if (terminal) {
        await expect(result).resolves.toMatchObject({
          text: '번역A\n\n번역B\n\n번역C\n\n번역D\n\n번역E\n\n번역F\n\n번역G\n\n번역H\n\n번역I',
          generation: { segments: 2, continuations: 1 },
        });
        expect(JSON.stringify(posts[1]?.body)).toBe(JSON.stringify(posts[2]?.body));
      } else {
        await expect(result).rejects.toMatchObject({ code: 'timeout_unknown', outcome: 'unknown' });
      }
      expect(posts).toHaveLength(expectedCalls);
    },
  );

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
