# 개발 환경과 검사

## 준비와 실행

저장소 루트의 `.nvmrc`에 고정된 Node 버전을 사용합니다. 현재 값은 `24.21.0`이며 CI도 같은 파일을 읽습니다. `package.json`의 지원 범위는 `^22.22.2 || ^24.15.0 || >=26.0.0`입니다. 버전이 바뀌면 이 두 파일을 기준으로 확인합니다.

```sh
# nvm을 쓰는 경우
nvm install
nvm use

npm ci
npm run dev
```

nvm이 없다면 `.nvmrc`의 Node 버전을 준비한 뒤 `npm ci`부터 실행합니다. `npm ci`는 저장소에 고정된 Capacitor Android 패치를 적용하며, 패키지 버전이나 패치 대상이 맞지 않으면 실패합니다.

Vite가 출력한 개발 서버 주소에서 `/tests/ui/renewal-preview.html`을 열면 합성 데이터로 만든 390 × 844 휴대폰 미리보기를 볼 수 있습니다. 실제 번역 요청을 보내지 않으며 제품 진입점에 포함되지 않습니다. 일반 브라우저 미리보기만으로 Android 네이티브 기능을 검증할 수는 없습니다.

## 변경 전후 검사

프로젝트 루트에서 실행합니다.

```sh
npm run format:check
npm run lint
npm run typecheck
npm test -- --run
npm run build
```

- `format:check`: `src`의 TypeScript·TSX·CSS, `tests`의 TypeScript·TSX·HTML, `tools`의 JS·MJS·TypeScript와 루트 설정 파일을 검사합니다. Markdown과 Java는 이 명령의 대상이 아닙니다.
- `lint`: `src`, `tests`, Vite·Capacitor 설정을 검사하며 경고도 실패로 처리합니다.
- `typecheck`: TypeScript의 별도 타입 검사입니다. `strict`와 `noUncheckedIndexedAccess`를 유지합니다.
- `npm test -- --run`: Vitest를 한 번 실행합니다. 일반 회귀 검사는 합성 데이터와 모의 전송 계층을 사용하며 실제 서버·소설·개인 자격 증명이 필요하지 않습니다.
- `build`: Vite 제품 번들을 만듭니다. Android APK 빌드나 실제 기기 검증을 대신하지 않습니다.

문서만 바꿨다면 diff, 상대 링크, 명령과 현재 설정의 일치를 확인하고 PR의 필수 CI 결과를 확인합니다. 실행하지 않은 빌드·기기 검사를 통과했다고 기록하지 않습니다. 의존성이나 배포 자산을 바꿨다면 제3자 고지 검사도 확인합니다.

```sh
node tools/licenses/generate-notices.mjs --check
```

## 현재 구현과 검증 범위

제품 진입점은 `src/app/bootstrap.tsx`이며 `src/app/compose.ts`에서 제공자·저장소·플랫폼 어댑터를 연결합니다. 화면은 `src/ui`, 앱 흐름은 `src/app/renewalController.ts`, 네이티브 경계는 `src/platform`과 `android/app/src/main/java`에 있습니다. 소스 탐색, 모델 연결과 번역, 보안 설정 저장, 서재 저장 기능은 통합되어 있습니다. 각 기능의 실제 기기 동작은 해당 APK와 실행 기록으로 따로 확인합니다.

`src/ui/legacy`와 `src/app/legacy`는 현재 트리에 없습니다. `src/storage/legacy`와 마이그레이션 코드는 이전 저장 형식을 옮기기 위한 코드이므로 이름만 보고 삭제하지 않습니다.

ESLint는 Babel의 TypeScript·JSX 파서와 React Hooks 규칙을 사용합니다. 타입 정보를 이용하는 TypeScript lint 검사를 제공하는 구성은 아니며 타입 오류는 별도 `typecheck`로 검사합니다. 설정의 실제 범위는 `eslint.config.mjs`와 `tsconfig.json`을 확인합니다.

## Android와 과거 검증 기록

- [Android 빌드·검증](android-validation.md): JDK·SDK 준비, APK 감사, 합성 검사와 실제 기기 검증의 차이
- [릴리스 서명과 배포](release.md): 유지관리자용 릴리스 절차. 개발자는 개인 서명키를 받을 필요가 없습니다.
- [기여 안내](../CONTRIBUTING.md): 이슈·작업 브랜치·PR 흐름과 유지관리 규칙

`docs/renewal/`과 `docs/superpowers/`에는 날짜가 있는 과거 조사·계획·검증 기록이 있습니다. 기록에 적힌 소스 커밋과 당시 결과를 보존하며, 현재 구현 상태나 최신 APK 검증 결과로 그대로 해석하지 않습니다.
