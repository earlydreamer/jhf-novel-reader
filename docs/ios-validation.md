# iOS 연구 앱과 원격 iPhone 실기 검증

이 문서는 `codex/research-ios` 연구 브랜치용이다. iOS 구현을 `main`이나 Android 릴리스에 합치지 않는다. Windows에서는 별도 워크트리를 사용하고, Mac에서는 실행 요청마다 별도 소스 checkout을 만든다. 시뮬레이터는 사용하지 않는다.

## 구현 구성

독서 화면·번역 엔진·용어집·저장 형식·백업의 앱 데이터 검증은 기존 TypeScript를 공유한다. Capacitor 8.5.2는 화면과 네이티브 경계 역할을 한다. iOS 기기 동작은 Swift로 구현한다.

| 역할 | 구현과 선택 이유 |
| --- | --- |
| 나로우 탐색 | 독립 `WKWebView`와 비영구 저장소. 원격 페이지에는 Capacitor 브리지를 설치하지 않으며, 탐색 URL과 가져올 작품 URL을 따로 검사한다. |
| 모델 목록·일반 HTTP | 격리된 `URLSessionConfiguration.ephemeral`. WebView 쿠키와 인증 상태를 공유하지 않고 리다이렉트를 거부한다. |
| 스트리밍 번역 | `URLSessionDataDelegate`. UTF-8 문자를 바이트 경계에서 자르지 않고 SSE 줄을 전달한다. 취소·백그라운드 전환 시 요청을 중단한다. |
| 서재와 설정 | 기존 Capacitor Filesystem·Preferences. 데이터는 `Library/NoCloud/narou-reader`에 저장한다. |
| 인증값 | 기존 SecureStorage의 iOS Keychain 구현. 기기 한정 저장과 iCloud 동기화 금지 설정을 유지한다. |
| 백업·복원 | ZIPFoundation 0.9.20과 시스템 문서 선택기. Android와 같은 백업 형식이다. 크기·경로·중복·CRC·manifest 검증 후 기존 TypeScript 검증을 거쳐 교체한다. 교체 전 undo 기록으로 파일과 설정을 함께 복구한다. |
| 기기 용어 판정 | Google LiteRT-LM 0.18.0 Swift SDK와 Android와 같은 EmbeddingGemma 2 모델·해시·256차원 출력. 번역 LLM을 아이폰에 올리지 않는다. 선택 기능이며 백그라운드·메모리 경고 때 해제한다. |
| 테마·화면 유지 | `overrideUserInterfaceStyle`, `isIdleTimerDisabled` 등 UIKit API. |

네이티브 의존성 버전과 SPM 해석 결과를 고정한다. 라이선스는 앱의 기존 제3자 고지에 추가하며, LiteRT-LM 배포물의 제3자 고지 묶음도 리소스로 보존한다.

공식 근거: [Capacitor 사용자 네이티브 코드](https://capacitorjs.com/docs/ios/custom-code), [Apple URLSession](https://developer.apple.com/documentation/foundation/urlsession), [ZIPFoundation](https://github.com/weichsel/ZIPFoundation/tree/0.9.20), [LiteRT-LM Swift 소스](https://github.com/google-ai-edge/LiteRT-LM/tree/v0.18.0/swift).

## Mac 최초 준비

- Apple Silicon Mac에 Xcode 26 이상과 iPhoneOS SDK, 프로젝트 Node 환경을 준비한다. 원격 SSH 접속 자체는 Tailnet의 기존 SSH 설정을 사용한다.
- iPhone의 개발자 모드·Mac 신뢰·개발자 앱 신뢰를 설정하고 USB로 연결한다.
- Xcode 계정을 로그인하고 제품 앱 `dev.earlydreamer.jhfreader`의 개발팀과 프로필을 처음 발급한다. CLI에서 계정 자격정보를 읽지 못하면 Xcode에서 계정 상태와 제품 타깃의 Signing을 확인한다. 환경 샘플 앱의 프로필은 제품 앱의 프로필을 대신하지 못한다.
- Mac의 `~/.local/share/jhf-ios/env.sh`에서 Node의 PATH를 설정하고 `development-team` 파일에 Team ID 한 줄을 둔다. 비밀번호는 저장하지 않는다.
- 해당 Mac 사용자로 데스크톱에 로그인한 상태여야 한다. 서명은 로그인 세션의 일회성 launchd 작업에서 수행한다. 작업 후 등록을 해제하며 Xcode·IDE를 계속 실행할 필요는 없다.

Xcode GUI에서 팀을 선택할 때만 로컬의 `ios/signing.local.xcconfig`에 `DEVELOPMENT_TEAM = 실제팀ID`를 둘 수 있다. 이 파일은 Git에 올리지 않는다. CLI 빌드는 저장소 밖의 팀 설정을 명시적으로 전달한다.

## Windows에서 직접 빌드·설치 요청

PowerShell 7과 `ssh`, `scp`, `git`, `tar`를 사용한다. `jhf-ios`는 사용자가 설정한 Mac SSH 별칭이다.

```powershell
# 현재 iOS 작업 워크트리에서 실행한다. PR·push·CI를 먼저 실행할 필요가 없다.
./tools/ios/device.ps1 -SshHost jhf-ios

# 같은 실제 iPhone에서 자동 smoke 검사까지 실행한다.
./tools/ios/device.ps1 -Action test -SshHost jhf-ios

# 페어링된 iPhone이 여러 대라면 CoreDevice ID를 명시한다.
./tools/ios/device.ps1 -Action install -SshHost jhf-ios -DeviceId '실제-CoreDevice-ID'
```

기본값은 페어링된 iPhone 한 대를 자동 선택한다. 한 대로 결정할 수 없으면 명시적인 DeviceId를 요구한다. 도구는 로컬 HEAD의 Git bundle과 미커밋 변경을 포함한 소스 스냅샷을 전달한다. `.gitignore`로 제외된 로컬 설정·기록·인증 파일은 전달하지 않는다. 전송 해시를 검증한 뒤 독립 checkout에서 `npm ci`와 `npm run ios:sync`를 실행한다.

서명 빌드는 실제 기기의 UDID 목적지만 사용하며 `-jobs 2`와 단일 빌드 잠금으로 제한한다. 성공하면 서명을 검사하고 설치·실행한다. 결과와 소스 해시는 Mac 작업 폴더와 Windows 출력 폴더의 JSON 및 로그에 남는다. 미커밋 스냅샷의 `dirty: true`는 숨기지 않는다. 이때 정확한 소스는 전송 아카이브 해시와 함께 식별한다.

`-Action test`는 서재·설정 화면, 별도의 시험 경로를 사용한 파일·Preferences·Keychain 저장, 기본 상태의 기기 모델 미로드, 잘못된 탐색 주소 차단, 아이폰 내부 합성 HTTP/SSE 서버로 Unicode·리다이렉트 거부를 검사한다. 실제 사용자 작품·API 키를 픽스처에 넣지 않는다. 테스트의 화면 첨부는 `DeviceTests.xcresult`에 보관한다. 합성 스트리밍 검사를 실제 모델의 번역 품질 검증으로 해석하지 않는다.

## 직접 기능 확인

1. iPhone의 실제 **JHF Novel Reader** 앱을 열고 서재와 설정이 표시되는지 본다.
2. 설정에서 아이폰이 접근할 수 있는 번역 서버 주소를 입력하고 연결 확인·모델 선택을 한다. 아이폰에서 `localhost`는 아이폰 자신을 가리킨다. PC의 사설 주소를 쓰려면 같은 네트워크 또는 이미 구성한 안전한 경로가 필요하다.
3. 시스템이 로컬 네트워크 접근을 요청하면 허용한다. HTTP를 지원하기 위한 ATS 예외는 네이티브 요청에 필요하며, 앱 WebView의 CSP와 원격 탐색의 HTTPS 허용 목록은 유지한다.
4. 작품 찾기에서 작품을 선택해 가져오고, 회차 번역·중단·문단 재번역·용어집 편집을 확인한다.
5. 앱을 다시 열어 저장본·읽기 위치가 유지되는지, 서버 연결 없이 저장본을 읽을 수 있는지 확인한다.
6. 백업을 파일 앱에 저장하고 복원한다. API 키와 기기 임베딩 모델은 백업 대상이 아니다.
7. 기기 용어 판정은 별도로 켜서 검사한다. 파일 크기 약 165MB는 실행 시 최대 메모리 사용량을 뜻하지 않는다. iPhone 12의 실제 추론 성능·최대 메모리·장시간 독서는 별도 실측 항목이다.

## 현재 검증 기록

- TypeScript 플랫폼 경계와 기존 전체 테스트를 실행했다. 정확한 최종 개수와 소스 커밋은 PR에 기록한다.
- Mac에서 ZIP 왕복·원본 보존·잘못된 경로/manifest/중복 거부·복원 실패 후 재시작 복구·손상 ZIP/심볼릭 링크 거부 검사 5개가 통과했다. 이는 macOS 호스트 검사다.
- 실제 제품 iPhoneOS 빌드와 실기 검사 타깃의 `build-for-testing` 컴파일이 통과했다. 시뮬레이터는 실행하지 않았다.
- 최초 실기 서명 시 제품 앱 프로필 부재 및 CLI의 `missing Xcode-Username` 오류가 확인됐다. 최종 설치·실기 실행 결과가 확보되면 이 항목을 갱신한다. 컴파일 성공을 설치 성공으로 기록하지 않는다.
