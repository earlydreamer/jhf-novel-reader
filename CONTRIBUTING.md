# 기여 안내

JHF Novel Reader의 버그 수정, 문서 개선, 기능 제안은 이슈와 PR로 진행합니다. 처음 참여한다면 아래 순서로 개발 환경을 준비하고 변경을 제안합니다.

## 변경할 내용을 먼저 정합니다

버그 이슈에는 재현 순서, 기대한 동작, 실제 동작을 적습니다. 기능 제안에는 누구에게 필요한 기능인지와 바뀔 동작을 설명합니다. 큰 변경은 구현하기 전에 이슈에서 범위를 정합니다.

하나의 PR은 하나의 기능이나 결함을 다룹니다. 관련 없는 개선은 별도 이슈로 나눕니다. 서버 인증값, 개인 주소, 실제 소설 본문, 원시 모델 응답은 이슈나 스크린샷에 포함하지 않습니다.

## 저장소와 작업 브랜치를 준비합니다

저장소에 접근할 수 있고 fork가 허용되어 있다면 자신의 계정으로 fork합니다. `<your-account>`는 자신의 GitHub 계정으로 바꿉니다.

```sh
git clone https://github.com/<your-account>/jhf-novel-reader.git
cd jhf-novel-reader
git remote add upstream https://github.com/earlydreamer/jhf-novel-reader.git
git fetch upstream
```

이슈마다 별도 브랜치와 작업 폴더를 만듭니다. `<issue>`와 `<short-slug>`는 실제 이슈 번호와 짧은 설명으로 바꿉니다.

```sh
git worktree add -b codex/<issue>-<short-slug> ../jhf-<issue> upstream/main
cd ../jhf-<issue>
```

직접 쓰기 권한이 있다면 원본 저장소를 clone합니다. 이 경우 위 명령의 `upstream/main`을 `origin/main`으로 바꾸고, 원본 저장소의 작업 브랜치에 push합니다. 직접 쓰기 권한이 있어도 변경은 PR로 검토합니다.

## 실행하고 검사합니다

Node 버전은 `.nvmrc`를 따릅니다. nvm을 사용한다면 다음 명령으로 시작합니다.

```sh
nvm install
nvm use
npm ci
npm run dev
```

개발 서버의 `/tests/ui/renewal-preview.html`은 합성 데이터로 화면을 확인하는 미리보기입니다. 휴대폰, 번역 서버, 릴리스 서명키가 필요하지 않습니다.

코드를 바꿨다면 PR을 열기 전에 기본 검사를 실행합니다.

```sh
npm run format:check
npm run lint
npm run typecheck
npm test -- --run
npm run build
```

문서만 바꿨다면 링크, 명령, 설명이 현재 코드와 맞는지 확인합니다. 검사별 범위는 [개발 환경과 검사](docs/development-checks.md)에 정리되어 있습니다. 네이티브 기능은 [Android 검증 안내](docs/android-validation.md)를 함께 확인합니다.

## PR을 보냅니다

이번 변경의 파일만 커밋합니다. 커밋 제목은 `type: 한국어 변경 설명 (#이슈번호)` 형식을 사용합니다.

```sh
git add <changed-file>
git commit -m "docs: 개발 환경 안내 수정 (#123)"
git push -u origin codex/<issue>-<short-slug>
```

원본 저장소의 `main`을 대상으로 Draft PR을 엽니다. PR에는 다음 내용을 간단히 적습니다.

- 해결하는 문제와 변경 후 동작
- 관련 이슈와 변경 범위
- 실제로 실행한 검사와 결과
- 아직 확인하지 못한 사항

구현과 검증이 끝나면 검토를 요청합니다. 검토 의견을 반영하고 필수 CI 결과를 확인한 뒤 유지관리자가 병합합니다. 실행하지 않은 기기 검사나 과거 APK의 결과를 이번 변경의 성공 근거로 적지 않습니다.

## 참고 문서

- [개발 환경과 검사](docs/development-checks.md): 도구 버전, 명령, 검사 범위
- [아키텍처](docs/architecture.md): 현재 앱 흐름과 코드 위치
- [디자인 시스템](DESIGN.md): 화면과 컴포넌트 규칙
- [유지관리와 작업 규칙](docs/maintaining.md): 작업 분할, 병합, 브랜치·작업 폴더 정리의 상세 기준

일반 개발에는 릴리스 개인키가 필요하지 않습니다. 개인키·비밀번호·실제 사용자 데이터는 요청하거나 공유하지 않습니다.
