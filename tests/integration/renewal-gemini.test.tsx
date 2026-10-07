// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { createRenewalApplication } from '../../src/app/compose';
import type {
  AppLifecycle,
  HttpResponse,
  NativeHttpClient,
  NativeHttpRequest,
} from '../../src/contracts';
import { GEMINI_BASE_URL } from '../../src/providers/gemini';
import { createModelTransport, createSourceTransport } from '../../src/platform/http';
import { createLibraryStore } from '../../src/storage/library';

const workUrl = 'https://ncode.syosetu.com/n1234ab/';
const chapterUrl = `${workUrl}1/`;
const modelsUrl = `${GEMINI_BASE_URL}/models`;
const toc =
  '<h1 class="p-novel__title">合成作品</h1><div class="p-eplist__sublist"><a href="/n1234ab/1/">第一話</a></div>';
const chapterHtml =
  '<h1 class="p-novel__title">第一話</h1><div class="p-novel__body"><div class="p-novel__text"><p>開始</p><p>終わり</p></div></div>';

type Finish = 'STOP' | 'SAFETY' | 'OTHER';

function generationResponse(finishReason: Finish): string {
  return JSON.stringify({
    candidates: [
      {
        finishReason,
        content: { role: 'model', parts: [{ text: '저장할 한국어 본문' }] },
      },
    ],
  });
}

function harness(finishReason: Finish = 'STOP') {
  const bytes = new Map<string, string>();
  const preferences = new Map<string, string>();
  const secrets = new Map<string, string>();
  const requests: NativeHttpRequest[] = [];
  const lifecycle: AppLifecycle = {
    isActive: async () => true,
    subscribe: async () => async () => {},
  };
  const client: NativeHttpClient = {
    async request(input): Promise<HttpResponse> {
      requests.push(input);
      if (input.url === modelsUrl)
        return {
          status: 200,
          headers: {},
          url: input.url,
          data: JSON.stringify({
            models: [
              {
                name: 'models/gemini-synthetic',
                displayName: 'Gemini Synthetic',
                supportedGenerationMethods: ['generateContent'],
              },
              {
                name: 'models/embedding-synthetic',
                displayName: 'Embedding Synthetic',
                supportedGenerationMethods: ['embedContent'],
              },
            ],
          }),
        };
      if (input.method === 'POST')
        return { status: 200, headers: {}, url: input.url, data: generationResponse(finishReason) };
      if (input.url === workUrl)
        return {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
          url: input.url,
          data: toc,
        };
      if (input.url === chapterUrl)
        return {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
          url: input.url,
          data: chapterHtml,
        };
      throw new Error(`Unexpected test request: ${input.url}`);
    },
  };
  const files = {
    read: async (path: string) => bytes.get(path) ?? null,
    write: async (path: string, value: string) => {
      bytes.set(path, value);
    },
  };
  const app = createRenewalApplication({
    files,
    preferences: {
      get: async ({ key }: { key: string }) => ({ value: preferences.get(key) ?? null }),
      set: async ({ key, value }: { key: string; value: string }) => {
        preferences.set(key, value);
      },
    },
    secrets: {
      get: async (ref: string) => secrets.get(ref) ?? null,
      set: async (ref: string, value: string) => {
        secrets.set(ref, value);
      },
      remove: async (ref: string) => {
        secrets.delete(ref);
      },
    },
    lifecycle,
    sourceTransport: createSourceTransport(client),
    modelTransport: createModelTransport(client),
    browse: async () => ({ selectedUrl: chapterUrl }),
  });
  return { app, requests, store: createLibraryStore(files) };
}

async function selectChapter(h: ReturnType<typeof harness>) {
  await h.app.initialize();
  h.app.changeAutoTranslate(false);
  await h.app.browse();
  const chapter = h.app.getSnapshot().work?.chapters.at(0);
  if (!chapter) throw new Error('Test fixture did not create a chapter');
  await h.app.selectChapter(chapter);
  return chapter;
}

async function selectGemini(h: ReturnType<typeof harness>) {
  h.app.changeConnection({ provider: 'gemini', baseUrl: GEMINI_BASE_URL });
  await h.app.checkConnection('synthetic-gemini-key');
  h.app.chooseModel('gemini-synthetic');
}

it('uses Google only after explicit Gemini selection and filters its generation catalog', async () => {
  const h = harness();
  await h.app.initialize();

  expect(h.app.getSnapshot().connection.provider).toBe('openai-compatible');
  expect(h.requests.filter((request) => request.url.startsWith(GEMINI_BASE_URL))).toHaveLength(0);

  await selectGemini(h);

  expect(h.app.getSnapshot().models).toEqual([
    { id: 'gemini-synthetic', displayName: 'Gemini Synthetic', supportsGeneration: true },
  ]);
  expect(h.requests).toContainEqual(
    expect.objectContaining({
      url: modelsUrl,
      method: 'GET',
      headers: { Accept: 'application/json', 'x-goog-api-key': 'synthetic-gemini-key' },
    }),
  );
});

it('saves a Gemini plain-text version through the whole-chapter flow without fallback', async () => {
  const h = harness();
  const chapter = await selectChapter(h);
  await selectGemini(h);

  await h.app.translate();

  const posts = h.requests.filter((request) => request.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({
    url: `${GEMINI_BASE_URL}/models/gemini-synthetic:generateContent`,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-goog-api-key': 'synthetic-gemini-key',
    },
  });
  expect(posts[0]?.headers).not.toHaveProperty('Authorization');
  expect(posts[0]?.data).not.toHaveProperty('responseFormat');
  const versions = await h.store.listVersions(chapter.chapterId);
  expect(versions).toHaveLength(1);
  expect(versions[0]).toMatchObject({
    text: '저장할 한국어 본문',
    provenance: { provider: 'gemini', modelId: 'gemini-synthetic' },
  });

  const versionId = versions[0]?.versionId;
  if (!versionId) throw new Error('Test fixture did not save a version');
  h.app.changeConnection({ provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1234/v1' });
  await h.app.selectChapter(chapter);
  expect(h.app.getSnapshot().version?.versionId).toBe(versionId);
  expect(h.requests.filter((request) => request.method === 'POST')).toHaveLength(1);
});

it.each(['SAFETY', 'OTHER'] as const)('does not save a %s Gemini result', async (finishReason) => {
  const h = harness(finishReason);
  const chapter = await selectChapter(h);
  await selectGemini(h);

  await h.app.translate();

  expect(h.requests.filter((request) => request.method === 'POST')).toHaveLength(1);
  await expect(h.store.listVersions(chapter.chapterId)).resolves.toEqual([]);
});
