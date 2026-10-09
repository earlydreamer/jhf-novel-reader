#!/usr/bin/env node
// KANJIDIC2에서 앱이 쓰는 한자 정보만 추려 src/translation/kanjidic.json을 만든다. Node 내장 모듈만 쓴다.
//   node tools/kanjidic/build-kanjidic.mjs [kanjidic2.xml.gz 경로]  → kanjidic.json 쓰기
//   node tools/kanjidic/build-kanjidic.mjs --check [경로]           → 쓰지 않고 커밋된 파일과 다르면 차이를 출력하고 exit 1
// 원본: http://www.edrdg.org/kanjidic/kanjidic2.xml.gz (EDRDG, CC BY-SA 4.0). 원본은 커밋하지 않는다.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outputPath = join(root, 'src/translation/kanjidic.json');
const defaultInput = join(root, '.superpowers/kanjidic/kanjidic2.xml.gz');
const SOURCE = 'KANJIDIC2 (EDRDG), CC BY-SA 4.0';

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(text) {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (match, body) => {
    if (body.startsWith('#x')) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(Number(body.slice(1)));
    return XML_ENTITIES[body];
  });
}

// 한 <character> 블록에서 필요한 값만 꺼낸다. 외부 파서 없이 정규식 스캔만 쓴다.
function extractCharacter(block) {
  const literal = /<literal>([^<]+)<\/literal>/.exec(block)?.[1];
  if (!literal) throw new Error('<literal>이 없는 <character>가 있다');
  const rmGroup = /<reading_meaning>([\s\S]*?)<\/reading_meaning>/.exec(block)?.[1] ?? '';
  const ko = [...rmGroup.matchAll(/<reading r_type="korean_h">([^<]*)<\/reading>/g)].map((m) =>
    decodeXml(m[1]),
  );
  // m_lang 속성이 없는 <meaning>만 영어 뜻이다. 앞에서부터 최대 3개.
  const en = [...rmGroup.matchAll(/<meaning>([^<]*)<\/meaning>/g)]
    .map((m) => decodeXml(m[1]))
    .slice(0, 3);
  return { literal: decodeXml(literal), ko, en };
}

export function buildKanjidic(xml) {
  const version = /<date_of_creation>([^<]+)<\/date_of_creation>/.exec(xml)?.[1];
  if (!version) throw new Error('<date_of_creation>이 없다');
  const blocks = xml.match(/<character>[\s\S]*?<\/character>/g) ?? [];
  const byChar = new Map();
  for (const block of blocks) {
    const { literal, ko, en } = extractCharacter(block);
    if (byChar.has(literal)) throw new Error(`한자가 중복됐다: ${literal}`);
    if (ko.length === 0 && en.length === 0) continue;
    for (const value of [...ko, ...en]) {
      if (value.includes('|')) throw new Error(`${literal}: 값에 구분자 |가 들어 있다`);
    }
    byChar.set(literal, [ko.join('|'), en.join('|')]);
  }
  const keys = [...byChar.keys()].sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
  const head = `{"version":${JSON.stringify(version)},"source":${JSON.stringify(SOURCE)},"k":{`;
  const lines = keys.map((key) => `${JSON.stringify(key)}:${JSON.stringify(byChar.get(key))}`);
  return { version, count: keys.length, text: `${[head, lines.join(',\n')].join('\n')}}}\n` };
}

function firstDifference(current, expected) {
  const a = current.split('\n');
  const b = expected.split('\n');
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return index + 1;
  }
  return 0;
}

function main(argv) {
  const check = argv.includes('--check');
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const inputPath = positional[0] ? resolve(process.cwd(), positional[0]) : defaultInput;
  if (!existsSync(inputPath)) {
    throw new Error(
      `원본이 없다: ${inputPath}. mkdir -p .superpowers/kanjidic && curl -fsSL -o .superpowers/kanjidic/kanjidic2.xml.gz http://www.edrdg.org/kanjidic/kanjidic2.xml.gz`,
    );
  }
  const compressed = readFileSync(inputPath);
  const xml = gunzipSync(compressed).toString('utf8');
  const built = buildKanjidic(xml);
  const outputBytes = Buffer.from(built.text, 'utf8');
  const gzipBytes = gzipSync(outputBytes).length;
  console.log(
    `한자 ${built.count}자, 원시 XML ${xml.length}바이트(압축 ${compressed.length}), 출력 ${outputBytes.length}바이트, 출력 gzip ${gzipBytes}바이트`,
  );

  const current = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : '';
  if (current === built.text) {
    console.log('src/translation/kanjidic.json 최신');
    return;
  }
  if (check) {
    const line = firstDifference(current, built.text);
    console.error(
      `src/translation/kanjidic.json이 생성 결과와 다르다(첫 차이: ${line}행). 다시 생성한다.`,
    );
    process.exitCode = 1;
    return;
  }
  writeFileSync(outputPath, built.text);
  console.log('src/translation/kanjidic.json 기록');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
