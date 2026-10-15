import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildNotices } from '../../tools/licenses/generate-notices.mjs';

interface NoticeItem {
  name: string;
  version: string;
  license: string;
  textId: string;
}
interface NoticeSection {
  id: string;
  title: string;
  items: NoticeItem[];
}
interface Notices {
  sections: NoticeSection[];
  texts: Record<string, string>;
}

const root = process.cwd();
const built = buildNotices(root);
const committedNotices = readFileSync(`${root}/src/ui/licenses/notices.json`, 'utf8');
const committedMarkdown = readFileSync(`${root}/THIRD_PARTY_NOTICES.md`, 'utf8');
const notices = JSON.parse(committedNotices) as Notices;
const lock = JSON.parse(readFileSync(`${root}/package-lock.json`, 'utf8')) as {
  packages: Record<string, { dev?: boolean; version: string }>;
};
const kanjidicVersion = (
  JSON.parse(readFileSync(`${root}/src/translation/kanjidic.json`, 'utf8')) as { version: string }
).version;

function section(id: string): NoticeSection {
  const found = notices.sections.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`섹션 ${id}이 없다`);
  return found;
}

describe('제3자 고지 생성물', () => {
  it('iOS 연구 앱에 추가한 Swift 구성 요소의 버전과 고지 원문이 있다', () => {
    for (const [name, version] of [
      ['LiteRT-LM Swift (iOS)', '0.18.0'],
      ['ZIPFoundation (iOS)', '0.9.20'],
      ['KeychainSwift (iOS)', '21.0.0'],
      ['IONFilesystemLib (iOS)', '2.0.1'],
    ]) {
      const item = section('direct').items.find((candidate) => candidate.name === name);
      expect(item?.version).toBe(version);
      expect(notices.texts[item?.textId ?? '']?.length).toBeGreaterThan(500);
    }
  });
  it('커밋된 THIRD_PARTY_NOTICES.md와 notices.json이 생성 결과와 같다', () => {
    expect(committedMarkdown).toBe(built.markdown);
    expect(committedNotices).toBe(built.json);
  });

  it('package-lock의 비개발 패키지(제외 목록 제외)가 모두 웹 섹션에 같은 버전으로 있다', () => {
    const web = new Map(section('web').items.map((item) => [item.name, item.version]));
    const shipped = Object.entries(lock.packages)
      .filter(([key, value]) => key.startsWith('node_modules/') && !value.dev)
      .map(([key, value]) => ({
        name: key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length),
        version: value.version,
      }))
      .filter((entry) => entry.name !== '@capacitor/ios');

    expect(shipped.length).toBeGreaterThan(0);
    for (const entry of shipped) {
      expect(web.get(entry.name), entry.name).toBe(entry.version);
    }
    expect(web.size).toBe(shipped.length);
  });

  it('모든 항목의 license가 비어 있지 않고 원문 textId가 texts에 있다', () => {
    for (const current of notices.sections) {
      for (const item of current.items) {
        expect(item.license, item.name).not.toBe('');
        expect(notices.texts[item.textId], item.name).toBeTypeOf('string');
        expect(notices.texts[item.textId]?.length, item.name).toBeGreaterThan(0);
      }
    }
  });

  it('KANJIDIC2가 직접 가져온 코드와 자산 섹션에 kanjidic.json 버전과 CC BY-SA 4.0 원문으로 있다', () => {
    const item = section('direct').items.find((candidate) => candidate.name === 'KANJIDIC2');
    expect(item?.version).toBe(kanjidicVersion);
    expect(item?.license).toBe('CC-BY-SA-4.0');
    expect(notices.texts[item?.textId ?? '']).toContain('Attribution-ShareAlike 4.0 International');
  });

  it('판정 모델 EmbeddingGemma 2가 직접 가져온 항목에 Apache-2.0 원문으로 있다', () => {
    const item = section('direct').items.find((candidate) =>
      candidate.name.startsWith('EmbeddingGemma 2'),
    );
    expect(item?.license).toBe('Apache-2.0');
    expect(notices.texts[item?.textId ?? '']).toContain('Apache License');
    expect(committedMarkdown).toContain('사용자가 설정에서 켜면 그 기기에 내려받습니다');
  });

  it('Android 섹션에 -bom 아티팩트가 없다', () => {
    for (const item of section('android').items) {
      expect(item.name.endsWith('-bom'), item.name).toBe(false);
    }
  });
});
