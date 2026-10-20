# iOS 연구 앱과 원격 iPhone 실기 검증

이 문서는 `codex/research-ios` 연구 브랜치용이다. iOS 구현을 `main`이나 Android 릴리스에 합치지 않는다. Windows에서는 별도 워크트리를 사용하고, Mac에서는 실행 요청마다 별도 소스 checkout을 만든다. 시뮬레이터는 사용하지 않는다.

## 구현 구성

독서 화면·번역 엔진·용어집·저장 형식·백업의 앱 데이터 검증은 기존 TypeScript를 공유한다. Capacitor 8.5.2는 화면과 네이티브 경계 역할을 한다. iOS 기기 동작은 Swift로 구현한다.

| 역할                | 구현과 선택 이유                                                                                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 나로우 탐색         | 독립 `WKWebView`와 비영구 저장소. 원격 페이지에는 Capacitor 브리지를 설치하지 않으며, 탐색 URL과 가져올 작품 URL을 따로 검사한다.                                                                     |
| 모델 목록·일반 HTTP | 격리된 `URLSessionConfiguration.ephemeral`. WebView 쿠키와 인증 상태를 공유하지 않고 리다이렉트를 거부한다.                                                                                           |
| 스트리밍 번역       | `URLSessionDataDelegate`. UTF-8 문자를 바이트 경계에서 자르지 않고 SSE 줄을 전달한다. 취소·백그라운드 전환 시 요청을 중단한다.                                                                        |
| 서재와 설정         | 기존 Capacitor Filesystem·Preferences. 데이터는 `Library/NoCloud/narou-reader`에 저장한다.                                                                                                            |
| 인증값              | 기존 SecureStorage의 iOS Keychain 구현. 기기 한정 저장과 iCloud 동기화 금지 설정을 유지한다.                                                                                                          |
| 백업·복원           | ZIPFoundation 0.9.20과 시스템 문서 선택기. Android와 같은 백업 형식이다. 크기·경로·중복·CRC·manifest 검증 후 기존 TypeScript 검증을 거쳐 교체한다. 교체 전 undo 기록으로 파일과 설정을 함께 복구한다. |
| 기기 용어 판정      | Google LiteRT-LM 0.18.0 Swift SDK와 Android와 같은 EmbeddingGemma 2 모델·해시·256차원 출력. 번역 LLM을 아이폰에 올리지 않는다. 선택 기능이며 백그라운드·메모리 경고 때 해제한다.                      |
| 테마·화면 유지      | `overrideUserInterfaceStyle`, `isIdleTimerDisabled` 등 UIKit API.                                                                                                                                     |

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

# 제품 ID용 프로필 발급 전, 기존 실기 검증 프로필로 실제 JHF를 연구용 ID에 설치한다.
# 이 ID용 유효한 프로필이 이미 Mac에 있어야 하며 기존 환경 샘플 앱을 대체한다.
./tools/ios/device.ps1 -SshHost jhf-ios -BundleId dev.earlydreamer.jhfreader.envcheck

# 같은 연구용 설치 ID에서 실제 기기 smoke 검사도 실행할 수 있다.
./tools/ios/device.ps1 -Action test -SshHost jhf-ios -BundleId dev.earlydreamer.jhfreader.envcheck

# 같은 실제 iPhone에서 자동 smoke 검사까지 실행한다.
./tools/ios/device.ps1 -Action test -SshHost jhf-ios

# 실제 공개 작품 추가·새 회차 검사. 합성 응답을 쓰지 않는 별도 검사만 실행한다.
./tools/ios/device.ps1 -Action test -SshHost jhf-ios -LiveSourceUrl https://ncode.syosetu.com/n3283lf/

# 페어링된 iPhone이 여러 대라면 CoreDevice ID를 명시한다.
./tools/ios/device.ps1 -Action install -SshHost jhf-ios -DeviceId '실제-CoreDevice-ID'
```

기본값은 페어링된 iPhone 한 대를 자동 선택한다. 한 대로 결정할 수 없으면 명시적인 DeviceId를 요구한다. 도구는 로컬 HEAD의 Git bundle과 미커밋 변경을 포함한 소스 스냅샷을 전달한다. `.gitignore`로 제외된 로컬 설정·기록·인증 파일은 전달하지 않는다. 전송 해시를 검증한 뒤 독립 checkout에서 `npm ci`와 `npm run ios:sync`를 실행한다.

연구용 ID 경로는 기존 프로필의 팀·앱 ID·실제 기기·유효기간이 모두 맞을 때만 기존 Xcode 관리 프로필로 서명한다. 앱 화면과 기능은 실제 JHF 소스이며, 환경 샘플 코드를 빌드하지 않는다. 앱 타깃의 `JHF_APP_BUNDLE_ID`만 덮어쓰므로 검사 타깃과 SDK 리소스의 식별자는 바꾸지 않는다. 제품 ID의 설치와 연구용 ID의 설치는 따로 기록한다.

서명 빌드는 실제 기기의 UDID 목적지만 사용하며 `-jobs 2`와 단일 빌드 잠금으로 제한한다. 성공하면 서명을 검사하고 설치·실행한다. 결과와 소스 해시는 Mac 작업 폴더와 Windows 출력 폴더의 JSON 및 로그에 남는다. 미커밋 스냅샷의 `dirty: true`는 숨기지 않는다. 이때 정확한 소스는 전송 아카이브 해시와 함께 식별한다.

`-Action test`는 서재·설정 화면, 별도의 시험 경로를 사용한 파일·Preferences·Keychain 저장, 기본 상태의 기기 모델 미로드, 잘못된 탐색 주소 차단, 아이폰 내부 합성 HTTP/SSE 서버로 Unicode·리다이렉트 거부를 검사한다. 실제 사용자 작품·API 키를 픽스처에 넣지 않는다. 테스트의 화면 첨부는 `DeviceTests.xcresult`에 보관한다. 합성 스트리밍 검사를 실제 모델의 번역 품질 검증으로 해석하지 않는다.

`-LiveSourceUrl`은 정규 나로우 작품 URL을 명시했을 때만 실제 서버에 요청한다. 이 옵션은 `-Action test`와 함께 사용하며 실제 작품 검사 한 개만 선택한다. 옵션을 생략한 기본 합성 검사는 유지되고 실제 서버 검사는 건너뛴다. 실서버 검사는 작품 추가 → 목차 렌더링 → 개별 새 회차 검사 → 서재 복귀를 실행하고, 기존 서재가 비어 있었을 때 전체 검사까지 실행한다. 응답을 대체하지 않으며 실제 네이티브 HTTP를 관찰해 URL·상태·바이트 수·시간만 JSON 첨부로 남긴다. 원문 응답이나 본문은 첨부하지 않는다. 추가한 작품은 확인할 수 있도록 서재에 남기며 기존 작품과 설정을 삭제하지 않는다. 조회 중 새 회차가 실제로 발행되지 않았다면 배지 없는 결과가 정상이며, 이를 실연재 증가 검증으로 해석하지 않는다.

## 직접 기능 확인

1. iPhone의 실제 **JHF Novel Reader** 앱을 열고 서재와 설정이 표시되는지 본다.
2. 설정에서 아이폰이 접근할 수 있는 번역 서버 주소를 입력하고 연결 확인·모델 선택을 한다. 아이폰에서 `localhost`는 아이폰 자신을 가리킨다. PC의 사설 주소를 쓰려면 같은 네트워크 또는 이미 구성한 안전한 경로가 필요하다.
3. 시스템이 로컬 네트워크 접근을 요청하면 허용한다. HTTP를 지원하기 위한 ATS 예외는 네이티브 요청에 필요하며, 앱 WebView의 CSP와 원격 탐색의 HTTPS 허용 목록은 유지한다.
4. 작품 찾기에서 작품을 선택해 가져오고, 회차 번역·중단·문단 재번역·용어집 편집을 확인한다.
5. 앱을 다시 열어 저장본·읽기 위치가 유지되는지, 서버 연결 없이 저장본을 읽을 수 있는지 확인한다.
6. 백업을 파일 앱에 저장하고 복원한다. API 키와 기기 임베딩 모델은 백업 대상이 아니다.
7. 기기 용어 판정은 별도로 켜서 검사한다. 파일 크기 약 165MB는 실행 시 최대 메모리 사용량을 뜻하지 않는다. iPhone 12의 실제 추론 성능·최대 메모리·장시간 독서는 별도 실측 항목이다.

## 현재 검증 기록

2026-10-20에 Windows에서 `device.ps1 -Action test`를 실행하여 정식 ID `dev.earlydreamer.jhfreader`를 연결된 iPhone 12에서 검증했다. 시뮬레이터는 사용하지 않았다.

| 실기 검사                    | 결과와 범위                                                                                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 서재·설정 렌더링             | 통과. 실제 앱 WebView의 화면과 설정 섹션·입력창을 확인하고 스냅샷 2개를 보관했다. 화면 전환은 JavaScript로 실행했으며 실제 손가락 터치 성공의 근거로 삼지 않는다. |
| 파일·Preferences·Keychain    | 통과. 별도의 합성 경로·키로 쓰기/읽기를 확인하고 시험 데이터를 삭제했다.                                                                                          |
| 선택적 임베딩·탐색 주소 검증 | 통과. 모델이 로드·다운로드되지 않은 기본 상태와 허용하지 않은 탐색 주소의 거부를 확인했다.                                                                        |
| 네이티브 HTTP·SSE            | 통과. 아이폰 내부 합성 서버에서 JSON, 리다이렉트 미추적, 한글 UTF-8 바이트 분할, SSE 완료를 확인했다.                                                             |

- XCTest 결과는 **4개 통과, 실패 0, 건너뜀 0**이다. 검사 후 서명 검증·설치·앱 실행도 성공했으며 영수증은 `signed: true`, `installed: true`, `launched: true`, 도구 종료 코드는 0이다.
- 검증·설치 소스는 `43d3e80b3fb44a858953813aff698799cacba328`, 전송 아카이브 SHA-256은 `6df493ce53d9fbcdb6264c3595083e4031f0963fdf8cd887b4e733735f1f4222`다. 후속 문서 커밋과 병합 커밋을 설치 소스로 표기하지 않는다.
- 원격 영수증의 `dirty: true`는 그대로 유지했다. 표시된 4개 경로는 `android/gradlew`, `android/gradlew.bat`의 실행 권한과 라이선스 HTML·PowerShell 도구의 줄바꿈 표현 차이였다. 각 경로의 Git 정규화 콘텐츠 해시가 HEAD와 같음을 다시 확인했다. Windows 소스 워크트리는 전송 당시 깨끗했다.
- 원본 `DeviceTests.xcresult`와 단계별 로그는 원격 작업 폴더에 보관하며, Windows 출력 폴더에 영수증·전송 해시·검사 요약·서재/설정 스냅샷을 회수했다. 기기 식별자와 사용자 정보가 포함될 수 있는 원본 로그는 공개 저장소에 올리지 않는다.
- 최초 프로필 부재·`missing Xcode-Username` 오류는 Xcode의 최초 정식 빌드 후 해소됐다. 이번 최초 실행에서 관찰한 개발자 인증서 신뢰 오류도 사용자가 아이폰에서 신뢰/앱 확인을 마친 뒤 같은 소스의 재실행으로 해소됐다. 완료된 일회성 launchd 작업과 빌드 잠금의 정리를 확인했다.
- 기존 TypeScript 전체 검사는 119파일·1,674개, macOS Swift 백업 단위 검사는 5개가 통과했다. 독립 리뷰에서 발견한 부재 저널 슬롯 반환 계약은 실패를 재현한 뒤 수정했고, 설정 화면 검사도 실제 설정 섹션을 확인하도록 강화했다.

실제 번역 서버·작품 가져오기부터 번역까지의 전체 동작, 파일 앱을 통한 수동 백업/복원, 재실행 후 사용자 데이터 보존, 기기 임베딩 추론·최대 메모리·장시간 성능은 별도 수동 확인 항목이다. 합성 HTTP/SSE 통과를 실제 번역 품질이나 전체 기능 검증으로 확대하지 않는다. 연구 브랜치의 실기 smoke 검증이며 App Store 배포 승인이나 main 도입을 뜻하지 않는다.
