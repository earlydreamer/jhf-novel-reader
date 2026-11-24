import { expect, test } from 'vitest';
import type { FilesystemPlugin } from '@capacitor/filesystem';
import type { ModelRequest, ModelTransport, SelectedModel } from '../../src/contracts';
import { GEMINI_BASE_URL } from '../../src/providers/gemini';
import { createGeminiProviderSession } from '../../src/providers/gemini/wholeChapter';
import { createGuidanceRepository } from '../../src/translation/guidance';
import { createTitleTranslation } from '../../src/translation/titles';
import { createNativePrivateFiles } from '../../src/storage/native';

const selection: SelectedModel = {
  connection: {
    provider: 'gemini',
    baseUrl: GEMINI_BASE_URL,
    authRef: 'provider.gemini-test',
    revision: 1,
  },
  modelId: 'gemini-synthetic',
};
const TRANSLATIONS: Record<string, string> = {
  夏の物語: '여름 이야기',
  夏の朝: '여름 아침',
  アリスの朝: '앨리스의 아침',
  冒険者ギルドの朝: '모험가 길드의 아침',
};

function harness() {
  const bytes = new Map<string, string>();
  const backend: Pick<FilesystemPlugin, 'readFile' | 'writeFile' | 'readdir'> = {
    async readFile({ path }) {
      const data = bytes.get(path);
      if (data === undefined) throw { code: 'OS-PLUG-FILE-0008' };
      return { data };
    },
    async writeFile({ path, data }) {
      if (typeof data !== 'string') throw new Error('Expected UTF-8 private data');
      bytes.set(path, data);
      return { uri: 'private' };
    },
    async readdir() {
      return { files: [] };
    },
  };
  const files = createNativePrivateFiles(backend, () => 'android');
  const posts: ModelRequest[] = [];
  /** 표기를 빠뜨린 응답을 한 번 돌려줄 원문. */
  let dropTermOnce: string | null = null;
  const transport: ModelTransport = {
    get: async () => {
      throw new Error('Catalog is not used by this fixture');
    },
    post: async (input) => {
      posts.push(input);
      const contents = input.body.contents as { parts: { text: string }[] }[];
      const prompt = contents.at(-1)!.parts[0]!.text;
      const main = prompt.slice(prompt.lastIndexOf('<main>'));
      const text = prompt.includes('<main>')
        ? '<main>' +
          [...main.matchAll(/<p id="([A-Za-z]+)">([^]*?)<\/p>/g)]
            .map(([, id, source]) => {
              const target =
                source === dropTermOnce ? ((dropTermOnce = null), '아침') : TRANSLATIONS[source!];
              return `<p id="${id}">${target}</p>`;
            })
            .join('') +
          '</main>'
        : prompt
            .split('\n\n')
            .map((source) => TRANSLATIONS[source])
            .join('\n\n');
      return {
        status: 200,
        headers: {},
        url: input.url,
        data: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] },
      };
    },
  };
  const guidance = createGuidanceRepository(files);
  const translate = createTitleTranslation(
    (selected) =>
      createGeminiProviderSession(selected, transport, {
        get: async () => 'synthetic-gemini-key',
        set: async () => {},
        remove: async () => {},
      }),
    guidance,
    true,
  );
  return {
    guidance,
    translate,
    posts,
    dropTermOnce(source: string) {
      dropTermOnce = source;
    },
  };
}

test('표기가 없는 Gemini 제목은 기존처럼 제목 전체를 한 번에 요청한다', async () => {
  const h = harness();
  await h.guidance.save('n1234ab', {
    terms: [{ source: 'アリス', target: '앨리스', aliases: [], category: '인명', note: '' }],
    voices: [],
  });
  expect(
    await h.translate(
      selection,
      'n1234ab',
      [
        { key: 'n1234ab', source: '夏の物語' },
        { key: 'n1234ab/1', source: '夏の朝' },
      ],
      new AbortController().signal,
    ),
  ).toEqual(['여름 이야기', '여름 아침']);
  expect(h.posts).toHaveLength(1);
  expect(h.posts[0]!.body.systemInstruction).toBeDefined();
  expect(JSON.stringify(h.posts[0]!.body)).not.toContain('Translation notes');
  expect(h.posts[0]!.url).toContain(':generateContent');
});

test('작품 표기가 있는 Gemini 제목은 표기를 넣어 요청하고 결과에 반영한다', async () => {
  const h = harness();
  await h.guidance.save('n1234ab', {
    terms: [{ source: 'アリス', target: '앨리스', aliases: [], category: '인명', note: '' }],
    voices: [],
  });
  expect(
    await h.translate(
      selection,
      'n1234ab',
      [
        { key: 'n1234ab', source: '夏の物語' },
        { key: 'n1234ab/1', source: 'アリスの朝' },
      ],
      new AbortController().signal,
    ),
  ).toEqual(['여름 이야기', '앨리스의 아침']);
  const sent = JSON.stringify(h.posts.map((post) => post.body));
  expect(sent).toContain('アリス->앨리스');
  expect(sent).toContain('<main>');
});

test('필수 표기를 빠뜨린 Gemini 제목은 표기 줄을 넣어 한 번 더 요청한다', async () => {
  const h = harness();
  await h.guidance.save('n1234ab', {
    terms: [{ source: 'アリス', target: '앨리스', aliases: [], category: '인명', note: '' }],
    voices: [],
  });
  h.dropTermOnce('アリスの朝');
  expect(
    await h.translate(
      selection,
      'n1234ab',
      [{ key: 'n1234ab/1', source: 'アリスの朝' }],
      new AbortController().signal,
    ),
  ).toEqual(['앨리스의 아침']);
  expect(h.posts).toHaveLength(2);
  expect(JSON.stringify(h.posts[1]!.body)).toContain('アリス → 앨리스');
});

test('작품 용어집이 없어도 Gemini 제목에 공용 용어집 표기를 참고로 넣는다', async () => {
  const h = harness();
  expect(
    await h.translate(
      selection,
      'n1234ab',
      [{ key: 'n1234ab/1', source: '冒険者ギルドの朝' }],
      new AbortController().signal,
    ),
  ).toEqual(['모험가 길드의 아침']);
  expect(h.posts).toHaveLength(1);
  expect(JSON.stringify(h.posts[0]!.body)).toContain('冒険者ギルド->모험가 길드');
});
