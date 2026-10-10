#!/usr/bin/env node
// 배포 구성 요소의 제3자 고지를 만든다. Node 내장 모듈만 쓴다.
//   node tools/licenses/generate-notices.mjs          → THIRD_PARTY_NOTICES.md, src/ui/licenses/notices.json 쓰기
//   node tools/licenses/generate-notices.mjs --check  → 쓰지 않고 현재 파일과 다르면 차이를 출력하고 exit 1
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 웹 번들(npm)에서 APK에 들어가지 않는 패키지. 이유를 함께 적는다.
const NOT_SHIPPED = {
  '@capacitor/ios': 'iOS 전용 네이티브 패키지라 Android APK에 들어가지 않음',
};

// package.json의 license 필드와 동봉 LICENSE.md 원문이 서로 다른 패키지의 명시적 예외 표.
// 근거: node_modules/@capacitor/synapse/LICENSE.md는 "MIT License, Copyright (c) 2025 Ionic" 원문이고
// package.json은 "license": "ISC"다. 효력 있는 문서는 동봉된 원문이므로 MIT로 적고 package.json 값은 비고로 남긴다.
// 일반 규칙이 아니다. 키의 버전과 declared 값이 맞을 때만 적용한다.
const LICENSE_OVERRIDES = {
  '@capacitor/synapse@1.0.4': {
    declared: 'ISC',
    license: 'MIT',
    note: 'package.json의 license 필드는 ISC',
  },
};

const CAPACITOR_MODULE_NOTE = 'Capacitor·플러그인 Android 모듈은 위 npm 패키지와 같은 라이선스.';

// 라이선스 이름만 있는 규칙에 붙일 원문 파일. 규칙에 text가 있으면 그 파일을 우선한다.
const LICENSE_TEXT_FILES = {
  'Apache-2.0': 'licenses/Apache-2.0.txt',
};

// 직접 가져온 코드·자산(고정 목록). 원문 파일은 licenses/ 아래에 있다.
// Capacitor 기본 구조의 MIT 원문은 android/NOTICE의 MIT 부분에서 꺼낸다.
const DIRECT = [
  {
    name: 'LNReader plugins: Syosetu 선택자와 추출 구조',
    version: '358388426c0b',
    license: 'MIT',
    textFile: 'licenses/lnreader-plugins-MIT.txt',
    md: [
      '- 출처: https://github.com/LNReader/lnreader-plugins , 고정 커밋 `358388426c0b23674b97760c352ee972b8e4d7b8`, 파일 [`plugins/japanese/Syosetu.ts`](https://github.com/LNReader/lnreader-plugins/blob/358388426c0b23674b97760c352ee972b8e4d7b8/plugins/japanese/Syosetu.ts)',
      '- 라이선스: MIT, Copyright (c) 2021 Rajarshee Chatterjee. 변경 없는 전체 원문은 아래 "라이선스 원문"에 있다.',
      '- 적용 위치: `src/source/parse.ts`(본문·회차 제목 선택자 `BODY`·`TITLE`, 목차 파싱 `parseWork`), `src/source/work.ts`(목차 선택자 사용). 본문 번호 제외 규칙과 페이지별 목차 선택자도 같은 파일에 있다.',
      '- 변경: Cheerio와 플러그인 fetch를 분리된 비활성 브라우저 템플릿과 주입된 SourceTransport로 바꿨다. HTML 대신 구조화된 문단·ruby를 낸다. URL·내비게이션 검증, 결정적 SHA-256 식별자, 접근 페이지 감지, 제한된 파싱, 취소 검사, 이전 선택자를 더했다. 랭킹·검색·필터·표지·user-agent 위장·플러그인 런타임·전체 페이지 수집은 제거했다.',
      '- 주의: 파싱 로직만 재사용한다. 업스트림 소설 픽스처나 본문은 포함하지 않는다. 업스트림 코드 라이선스는 소설 본문에 대한 권리나 자동 접근 허가를 주지 않는다. 이 앱 자체 코드는 MIT 라이선스(저장소의 LICENSE)이며, 그것이 소설 본문에 대한 권리를 주지 않는 것도 같다.',
    ],
  },
  {
    name: 'Pretendard Variable',
    version: '1.3.9',
    license: 'OFL-1.1',
    textFile: 'licenses/Pretendard-OFL.txt',
    md: [
      '- 출처: https://github.com/orioncactus/pretendard (npm `pretendard@1.3.9`)',
      '- 파일: `src/ui/theme/fonts/PretendardVariable.woff2` (수정 없이 복사)',
      '- 라이선스: SIL Open Font License 1.1. 전체 원문은 아래 "라이선스 원문"에 있다.',
    ],
  },
  {
    name: 'KANJIDIC2',
    // 버전은 생성된 한자 사전 파일의 version을 그대로 쓴다(고정값을 두지 않는다).
    versionFile: 'src/translation/kanjidic.json',
    license: 'CC-BY-SA-4.0',
    textFile: 'licenses/CC-BY-SA-4.0.txt',
    md: [
      '- 출처: https://www.edrdg.org/edrdg/licence.html (EDRDG), 원본 http://www.edrdg.org/kanjidic/kanjidic2.xml.gz',
      '- 파일: `src/translation/kanjidic.json` (원본에서 한자, 한국어 한자음, 영어 뜻만 추림)',
      '- 라이선스: Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0). 전체 원문은 아래 "라이선스 원문"에 있다.',
      "- 고지: This package uses the KANJIDIC2 dictionary file. These files are the property of the Electronic Dictionary Research and Development Group, and are used in conformance with the Group's licence.",
    ],
  },
  {
    name: 'Material Symbols (Outlined, weight 400)',
    version: '0.47.6',
    license: 'Apache-2.0',
    textFile: 'licenses/Apache-2.0.txt',
    md: [
      '- 출처: https://github.com/google/material-design-icons (npm `@material-symbols/svg-400@0.47.6`)',
      '- 파일: `src/ui/icons/*.svg` (앱이 쓰는 아이콘의 수정 없는 복사본)',
      '- 라이선스: Apache License 2.0. 전체 원문은 아래 "라이선스 원문"에 있다.',
    ],
  },
  {
    // 앱에 들어 있지 않다. 사용자가 설정에서 켤 때 기기에 내려받고 SHA-256으로 검증한다.
    name: 'EmbeddingGemma 2 (Google DeepMind)',
    version: '9be6e8b9',
    license: 'Apache-2.0',
    textFile: 'licenses/Apache-2.0.txt',
    md: [
      '- 출처: https://huggingface.co/litert-community/embeddinggemma-2-text-270m-litert-lm , 고정 커밋 `9be6e8b90982095dc05c2bd162e4b954ee4dbac7`',
      '- 파일: `embeddinggemma-2-text-270m.litertlm`. APK에 들어 있지 않고, 사용자가 설정에서 켜면 그 기기에 내려받는다.',
      '- 라이선스: Apache License 2.0. 전체 원문은 아래 "라이선스 원문"에 있다.',
    ],
  },
  {
    name: 'Capacitor Android 기본 구조',
    version: '8.5.2',
    license: 'MIT',
    textFile: 'android/NOTICE',
    textFrom: 'MIT License',
    md: [
      '- 출처: `@capacitor/cli` 8.5.2가 생성한 `android/` 기본 구조 (https://capacitorjs.com)',
      '- 라이선스: MIT, Copyright (c) 2017-present Drifty Co. 원문은 `android/NOTICE`의 MIT 부분과 같고 아래 "라이선스 원문"에 있다.',
    ],
  },
];

const SECTION_TITLES = {
  direct: '직접 가져온 코드와 자산',
  web: '웹 화면',
  android: 'Android',
};

function normalizeText(text) {
  return text.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
}

function readText(root, relPath) {
  const path = join(root, relPath);
  if (!existsSync(path)) throw new Error(`원문 파일이 없다: ${relPath}`);
  return normalizeText(readFileSync(path, 'utf8'));
}

// 같은 원문은 한 번만 담는다. 식별자는 라이선스 이름과 원문 해시로 정해서 실행마다 같다.
function textIdFor(license, text) {
  const safeLicense = license.replace(/[^A-Za-z0-9.-]+/g, '-');
  const hash = createHash('sha256').update(text).digest('hex').slice(0, 8);
  return `${safeLicense}-${hash}`;
}

function repositoryUrl(pkg, name) {
  const raw = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  if (raw) {
    return raw
      .replace(/^git\+/, '')
      .replace(/^git:\/\//, 'https://')
      .replace(/\.git$/, '');
  }
  if (pkg.homepage) return pkg.homepage;
  // repository와 homepage가 모두 없는 패키지는 npm 패키지 페이지를 출처로 쓴다.
  return `https://www.npmjs.com/package/${name}`;
}

function collectWeb(root, lock, texts) {
  const packages = lock.packages;
  const keys = Object.keys(packages)
    .filter((key) => key.startsWith('node_modules/') && !packages[key].dev)
    .sort();
  const items = [];
  const excluded = [];
  for (const key of keys) {
    const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
    if (NOT_SHIPPED[name]) {
      excluded.push({ name, reason: NOT_SHIPPED[name] });
      continue;
    }
    const dir = join(root, key);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    if (pkg.version !== packages[key].version) {
      throw new Error(
        `${name}: 설치된 버전(${pkg.version})과 package-lock(${packages[key].version})이 다르다. npm ci를 다시 실행한다.`,
      );
    }
    if (typeof pkg.license !== 'string' || pkg.license.trim() === '') {
      throw new Error(`${name}: package.json에 license가 없다`);
    }
    const licenseFile = readdirSync(dir)
      .filter((file) => /^(LICENSE|LICENCE|COPYING)/i.test(file))
      .sort()[0];
    if (!licenseFile) throw new Error(`${name}: 패키지 폴더에 LICENSE 파일이 없다`);
    const override = LICENSE_OVERRIDES[`${name}@${pkg.version}`];
    if (override && pkg.license !== override.declared) {
      throw new Error(
        `${name}: 예외 표의 declared(${override.declared})와 package.json(${pkg.license})이 다르다`,
      );
    }
    const license = override ? override.license : pkg.license;
    const text = normalizeText(readFileSync(join(dir, licenseFile), 'utf8'));
    const textId = textIdFor(license, text);
    texts.set(textId, text);
    items.push({
      name,
      version: pkg.version,
      license,
      textId,
      source: repositoryUrl(pkg, name),
      ...(override ? { note: override.note } : {}),
    });
  }
  items.sort(byName);
  return { items, excluded };
}

// Gradle 의존성 트리 출력에서 group:artifact → version을 모은다. a -> b면 b를 쓴다.
function parseMavenCoordinates(source) {
  const found = new Map();
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('project ')) continue;
    const match = /^[\s|+\\-]*([\w.-]+):([\w.-]+)(?::([\w.-]+))?(?:\s+->\s+([\w.-]+))?/.exec(raw);
    if (!match) continue;
    const [, group, artifact, declared, resolved] = match;
    const key = `${group}:${artifact}`;
    if (artifact.endsWith('-bom')) continue;
    const version = resolved ?? declared;
    if (!version) throw new Error(`Maven 버전을 알 수 없다: ${line}`);
    const previous = found.get(key);
    if (previous !== undefined && previous !== version) {
      throw new Error(`Maven 버전이 충돌한다: ${key} ${previous} / ${version}`);
    }
    found.set(key, version);
  }
  return found;
}

function collectAndroid(root, texts) {
  const dependencies = readText(root, 'tools/licenses/android-runtime-dependencies.txt');
  const rules = JSON.parse(readText(root, 'tools/licenses/maven-licenses.json')).rules;
  const coordinates = parseMavenCoordinates(dependencies);
  const items = [];
  const missing = [];
  for (const [key, version] of [...coordinates].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const rule = rules.find((candidate) => key.startsWith(candidate.match));
    if (!rule) {
      missing.push(`${key}:${version}`);
      continue;
    }
    const textPath = rule.text ?? LICENSE_TEXT_FILES[rule.license];
    if (!textPath)
      throw new Error(`${key}: 라이선스 ${rule.license}의 원문 파일이 지정되지 않았다`);
    const text = readText(root, textPath);
    const textId = textIdFor(rule.license, text);
    texts.set(textId, text);
    items.push({
      name: key,
      version,
      license: rule.license,
      textId,
      ...(rule.note ? { note: rule.note } : {}),
    });
  }
  if (missing.length) {
    throw new Error(
      `maven-licenses.json 규칙에 없는 Maven 아티팩트 ${missing.length}개: ${missing.join(', ')}. ` +
        '라이선스를 추측하지 말고 POM으로 확인해 규칙을 추가한다.',
    );
  }
  return items;
}

function collectDirect(root, texts) {
  return DIRECT.map((entry) => {
    let text = readText(root, entry.textFile);
    if (entry.textFrom) {
      const start = text.indexOf(entry.textFrom);
      if (start < 0) throw new Error(`${entry.textFile}에 ${entry.textFrom}이 없다`);
      text = normalizeText(text.slice(start));
    }
    const textId = textIdFor(entry.license, text);
    texts.set(textId, text);
    const version = entry.versionFile
      ? JSON.parse(readText(root, entry.versionFile)).version
      : entry.version;
    return {
      name: entry.name,
      version,
      license: entry.license,
      textId,
      md: entry.md,
    };
  });
}

function byName(a, b) {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function cell(value) {
  return String(value).replace(/\|/g, '\\|');
}

function table(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ];
}

function renderMarkdown({ direct, web, excluded, android, texts }) {
  const lines = [
    '# 제3자 고지',
    '',
    '이 앱에 포함된 제3자 구성 요소와 그 라이선스를 적는다. 앱 자체 코드는 MIT 라이선스이며 전문은 저장소의 LICENSE에 있다.',
    '이 파일은 `node tools/licenses/generate-notices.mjs`로 만든다. 직접 고치지 않는다.',
    '',
    '## 직접 가져온 코드와 자산',
    '',
  ];
  for (const item of direct) {
    lines.push(`### ${item.name}`, '', ...item.md, '');
  }

  lines.push('## 웹 화면 번들 (npm)', '');
  lines.push(
    ...table(
      ['패키지', '버전', '라이선스', '출처'],
      web.map((item) => [item.name, item.version, item.license, item.source]),
    ),
    '',
  );
  const webNotes = web.filter((item) => item.note);
  for (const item of webNotes) lines.push(`- \`${item.name}\` ${item.version}: ${item.note}`);
  if (webNotes.length) lines.push('');
  if (excluded.length) {
    lines.push(
      '제외한 패키지:',
      '',
      ...excluded.map((item) => `- \`${item.name}\`: ${item.reason}`),
      '',
    );
  }

  lines.push('## Android 라이브러리 (Maven)', '');
  lines.push(
    ...table(
      ['아티팩트', '버전', '라이선스'],
      android.map((item) => [item.name, item.version, item.license]),
    ),
    '',
    CAPACITOR_MODULE_NOTE,
    '',
  );
  const notes = android.filter((item) => item.note);
  for (const item of notes) lines.push(`- \`${item.name}\`: ${item.note}`);
  if (notes.length) lines.push('');

  lines.push('## 라이선스 원문', '');
  const componentsByText = new Map();
  const order = [];
  for (const item of [...direct, ...web, ...android]) {
    if (!componentsByText.has(item.textId)) {
      componentsByText.set(item.textId, []);
      order.push(item.textId);
    }
    componentsByText
      .get(item.textId)
      .push(item.version ? `${item.name} ${item.version}` : item.name);
  }
  // Apache-2.0 전문은 한 번만, 나머지는 처음 나온 순서대로 적는다.
  const apacheIds = order.filter((id) => id.startsWith('Apache-2.0-'));
  const others = order.filter((id) => !apacheIds.includes(id));
  for (const textId of [...apacheIds, ...others]) {
    const text = texts.get(textId);
    if (text.includes('```'))
      throw new Error(`${textId}: 원문에 코드 펜스가 있어 고지를 만들 수 없다`);
    const license = textId.replace(/-[0-9a-f]{8}$/, '');
    const components = componentsByText.get(textId);
    lines.push(
      `### ${license}`,
      '',
      `사용 구성 요소: ${components.join(', ')}`,
      '',
      '```text',
      text,
      '```',
      '',
    );
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

function renderJson({ direct, web, android, texts }) {
  const strip = (item) => ({
    name: item.name,
    version: item.version,
    license: item.license,
    textId: item.textId,
    ...(item.note ? { note: item.note } : {}),
  });
  const sortedTexts = {};
  for (const key of [...texts.keys()].sort()) sortedTexts[key] = texts.get(key);
  const notices = {
    sections: [
      { id: 'direct', title: SECTION_TITLES.direct, items: direct.map(strip) },
      { id: 'web', title: SECTION_TITLES.web, items: web.map(strip) },
      { id: 'android', title: SECTION_TITLES.android, items: android.map(strip) },
    ],
    texts: sortedTexts,
  };
  return `${JSON.stringify(notices, null, 2)}\n`;
}

export function buildNotices(root) {
  const lock = JSON.parse(readText(root, 'package-lock.json'));
  const texts = new Map();
  const direct = collectDirect(root, texts);
  const { items: web, excluded } = collectWeb(root, lock, texts);
  const android = collectAndroid(root, texts);
  return {
    markdown: renderMarkdown({ direct, web, excluded, android, texts }),
    json: renderJson({ direct, web, android, texts }),
  };
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
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const outputs = [
    { path: join(root, 'THIRD_PARTY_NOTICES.md'), label: 'THIRD_PARTY_NOTICES.md' },
    { path: join(root, 'src/ui/licenses/notices.json'), label: 'src/ui/licenses/notices.json' },
  ];
  const built = buildNotices(root);
  const expected = [built.markdown, built.json];
  let stale = false;
  outputs.forEach((output, index) => {
    const content = expected[index];
    const current = existsSync(output.path) ? readFileSync(output.path, 'utf8') : '';
    if (current === content) return;
    if (check) {
      stale = true;
      const line = firstDifference(current, content);
      console.error(`${output.label}이 생성 결과와 다르다(첫 차이: ${line}행). 다시 생성한다.`);
      return;
    }
    writeFileSync(output.path, content);
    console.log(`${output.label} 기록`);
  });
  if (stale) {
    console.error('node tools/licenses/generate-notices.mjs 로 다시 만든다.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
