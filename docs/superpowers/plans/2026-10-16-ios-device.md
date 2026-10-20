# JHF iOS 실기 지원 구현 계획

**목표:** 현재 기능을 유지한 제품 앱을 원격 Mac에서 빌드하여 연결된 iPhone에 설치한다. 시뮬레이터는 사용하지 않는다.

**구성:** 독서·번역·용어집·데이터 검증은 기존 TypeScript와 Capacitor 8.5.2를 재사용한다. 기기 경계는 Swift와 Apple SDK로 구현한다. 전체 화면을 다시 작성하기보다 동일한 저장 형식과 번역 엔진을 공유해 Android 회귀 위험을 줄인다.

**기술 선정:** 탐색은 앱 브리지 없는 독립 WKWebView, 스트리밍은 ephemeral URLSession, 문서 선택은 UIDocumentPickerViewController, 압축은 MIT ZIPFoundation, 기기 임베딩은 기존 모델과 동일 버전의 Google LiteRT-LM 0.18.0 Swift SDK를 사용한다. 키는 기존 SecureStorage의 Keychain 구현을 사용한다.

**요구 원본:** 이슈 #337 및 사용자의 현재 기능 유지·iPhone 12 실기·OSS/네이티브 구성 지시. 계획 승인 질문을 추가하지 않고 이미 요청한 구현을 계속한다. 실행은 현재 에이전트가 담당한다.

**격리와 병합 대상:** Windows `narou-reader-337` 및 Mac의 별도 작업 폴더에서 진행한다. PR의 base와 병합 대상은 `codex/research-ios`이며 `main`에 iOS 코드를 반영하지 않는다. 기존 외부 서비스 연구 브랜치에도 섞지 않는다.

## 공통 제약과 검토 초점

- 시뮬레이터·IDE 상주 없이 iPhoneOS 대상, 동시 빌드 한 건, `-jobs 2`.
- 개인 팀·기기·주소·서명 데이터는 저장소 밖에서 전달한다.
- 원격 페이지에 Capacitor 브리지를 노출하지 않고 탐색·선택 URL을 각각 검증한다.
- 모델 POST는 리다이렉트·쿠키·앱 차원의 자동 재시도 없이 처리한다. 취소·백그라운드 전환 후 소켓을 정리한다.
- 백업은 크기·경로·중복·CRC·앱 데이터 검증을 마친 뒤 교체하며, 중단 후 복구 가능성을 검증한다. 기존 데이터·보안키·모델 파일을 혼합하지 않는다.
- 의존성 버전을 고정하고 개발용 HTTP 서버 접근을 WebView 전체 탐색 허용으로 확대하지 않는다.

## 작업 1: iOS 공통 로직 연결

파일: `package.json`, `capacitor.config.ts`, `src/app/compose.ts`, `src/platform/{browse,backup}.ts`, `src/platform/http/stream.ts`, 관련 플랫폼 테스트, `ios/App`.

- [x] iOS에서 탐색과 백업이 차단되는 회귀 테스트를 먼저 실행한다.
- [x] iOS 네이티브 어댑터를 연결하고 Capacitor 기본 프로젝트를 구성한다.
- [x] `npm run ios:sync` 반복 실행 후 연결이 보존되는지 확인한다.

## 작업 2: iOS 네이티브 연결부

파일: `ios/JHFNative/Package.swift`, `Sources/JHFNative/{SourceBrowserPlugin,ModelStreamPlugin,ShellPlugins,OnDeviceEmbeddingPlugin,BackupPlugin}.swift`, `Sources/JHFBackup/BackupArchive.swift`, `Tests/JHFBackupTests`, 앱의 `JHFBridgeViewController.swift`.

인터페이스: 기존 TypeScript `SourceBrowser`, `ModelStream`, `Backup`, `ReaderTheme`, `ScreenAwake`, `AppReady`, `OnDeviceEmbedding` 플러그인 계약을 그대로 구현한다.

- [x] 경로 탈출·잘못된 manifest·압축 손상·중단 복구 테스트를 추가하고 Mac에서 실패를 확인한다.
- [x] Swift 구현과 고정된 OSS 패키지를 연결한다.
- [x] 호스트 단위 검사와 실제 iPhoneOS 컴파일로 검증한다.

## 작업 3: 원격 실기 설치

파일: `tools/ios/` 빌드·전송 도구, `docs/ios-validation.md`.

- [x] 로컬 소스 스냅샷을 별도 원격 작업 폴더에 전달하고 해시를 확인한다.
- [x] 로그인 세션의 일회성 CLI 작업으로 정식 앱 ID의 빌드·서명·설치와 단계별 결과 회수를 확인한다.
- [x] 기기 잠금 해제·개발자 인증서 신뢰 후 앱 실행과 실제 iPhone의 smoke 검사 4개 통과를 확인한다.
- [x] 기기 실행·네이티브 호출·저장·모델 통신에서 확인된 범위와 수동 확인 항목을 나눠 기록한다.

## 작업 4: 전달

- [x] format, lint, typecheck, 전체 Vitest, production build를 실행한다.
- [x] 한국어 커밋·Draft PR을 만들고 이슈에 검증 근거를 연결한다.
- [x] 실제 설치 소스와 후속 문서 커밋의 관계, 작업 폴더 상태, 남은 실기 확인을 기록한다.
- [x] 실기 검사를 마쳤고 검증된 PR의 병합 대상이 `codex/research-ios`임을 확인한다. main은 제외한다. 실제 병합 결과는 PR과 최종 전달 보고에서 확인한다.
