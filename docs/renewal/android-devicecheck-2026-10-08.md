# Android 실기 검증 — 디자인 시스템 #92 (2026-10-08)

## 검증 기준

설치 동작은 제품 수정 커밋 `6ff31b8f817bd0be6b689818f6b1d62db445dbe8` (tree `6b6d3a191b53a64e1034c1b35fb0acbc077a4402`) 기준으로 판정했다. 제품 변경은 `android/app/src/main/java/app/narou/reader/MainActivity.java`에서 `super.onCreate` 직후 `WindowCompat.enableEdgeToEdge(getWindow())`를 호출하는 두 줄이다. AndroidX Core 1.17.0이 이미 사용 중이라 의존성을 추가하지 않았다.

Astra 코드 감사는 이 두 줄 변경을 승인했고, `git diff --check`가 통과했다. 제품 소스 커밋은 CI에서 모두 성공했다: [Checks run 37698455923 / job 113055866754](https://github.com/earlydreamer/narou-reader/actions/runs/37698455923), [Android run 37698456004 / job 113055867281](https://github.com/earlydreamer/narou-reader/actions/runs/37698456004).

## APK와 출처

| 용도 | 패키지 | 출처 및 SHA-256 | 설치 경계 |
| --- | --- | --- | --- |
| 출시 코드 정적 감사 | `app.narou.reader` | commit/tree는 위 기준. APK `585e4a0d66e5d05d8eb8ed6f16222920a61a90815a5faa7091d5171e0abf38cd`. `node tests/e2e/verify-apk.mjs` 통과, 출처 `dirty:false`. | 파일·서명·매니페스트 감사만 했다. 어느 기기에도 설치하지 않았다. |
| 최종 실기 APK | `app.narou.reader.devicecheck` | 같은 6ff31b8 제품 소스에서 임시 Gradle `applicationIdSuffix '.devicecheck'`만 적용해 빌드. APK `edfb6380100cc739b40a7c08f0d1e7b6d982a71e1e1051e8a11347e818b96fbc`. 서명 인증서 SHA-256 `8c5d8712374dff61e93c2ecbcc240a17d2db4759c97ee4ab11275322aa5fe0a6`. suffix diff SHA-256 `de672d105f516b8550d2dc223b46c9b71440e1c8cd15d6a3ea0c7fe506a1efed`. | Black Shark 2와 Galaxy Z Fold7의 별도 테스트 패키지로만 설치했다. Application 테스트 버튼/대화상자 훅은 없다. |
| 대화상자 시스템 뒤로가기 탐침 | `app.narou.reader.devicecheck` | 기반 commit `617275dbfda35c1c02f61777a8f1de9f15f3d0cf` + 임시 `Application.tsx` 테스트 훅 diff SHA-256 `c4aa75f62a15ec3f6e9a9a8a94e46eb5d77bee72852dfc8820d37bdc5ea29627`. 훅 APK SHA-256 `9609cbf1abbb7dd21e9d3e436d153673ea7ec9d3a55fc1b0f2dcff3c65616384`. | 실제 제품 `Application` 셸·back handler와 실제 `Dialog` 컴포넌트를 이용했다. 홈의 임시 버튼만 추가한 실기 탐침이며 기존 제품 UI로 간주하지 않는다. 검증 후 소스에서 제거했고 최종 실기 APK에도 없다. |

최종 테스트 APK의 네이티브 provenance에는 임시 Gradle suffix 때문에 `dirty:true`가 기록된다. 웹 자산 provenance는 `dirty:false`이고 6ff31b8/tree와 일치한다. 임시 suffix는 빌드 후 원래 Gradle 파일 바이트로 복원했으며, 현재 워크트리에 Gradle·Application 임시 변경은 없다. 테스트 APK 설치 전 패키지 ID를 `aapt`로 확인하고 v2 서명·인증서·SHA-256을 확인했다.

## 기기 및 결과

| 기기 | OS / API | WebView | 시작 글꼴 배율 → 복원 |
| --- | --- | --- | --- |
| Black Shark 2 (SKW-H0) | Android 10 / API 29 | 153.0.8010.36 | 1.0 → 1.0 |
| Galaxy Z Fold7 (SM-F966N) | Android 16 / API 36 | 154.0.8037.58 | 0.9 → 0.9 |

- **상태 표시줄 대비:** 수정 전 Black Shark 2에서 앱 다크 / 시스템 라이트 조합은 밝은 시스템 바탕에 흰 아이콘이 그려져 대비가 부족했다. edge-to-edge 적용 후 같은 조합에서 시스템 바 영역이 앱의 어두운 배경으로 이어지고 밝은 시계·아이콘이 식별됐다. 최종 6ff31b8 무훅 APK에서도 이 조합을 다시 확인했다. 반대 불일치인 앱 라이트 / 시스템 다크는 Fold7에서 밝은 바탕과 어두운 아이콘으로 읽혔다. 일치 조합은 Black Shark 2 라이트/라이트, Fold7 다크/다크에서 확인했다. 내비게이션 바 아이콘도 각 표면에서 식별됐다.
- **인셋과 방향:** 두 기기의 세로·가로 화면에서 앱 콘텐츠가 상태 표시줄과 내비게이션 영역에 겹치거나 중복 패딩되지 않았다. Black Shark 2 가로 화면에서 URL 입력란을 눌러 키보드가 열린 뒤 시스템 Back으로 키보드만 닫히고 화면이 유지됐다. 두 기기의 방향 고정/자동 회전 값은 기존 상태로 복원했다.
- **대화상자 뒤로가기:** 임시 훅은 제품 `Dialog`와 제품 back handler를 통해 실제 대화상자를 열었다. 양 기기에서 시스템 Back 한 번으로 대화상자만 닫히고 현재 화면이 유지됐다. 최종 무훅 APK에는 이 진입 버튼이 없으므로 해당 결과는 위 탐침 APK 범위로 한정한다.
- **루트 뒤로가기:** 최종 변경이 포함된 별도 패키지에서 각 기기의 홈 화면에 시스템 Back을 보내 launcher가 최상위가 되고 테스트 앱 프로세스는 살아 있음을 확인했다.
- **글꼴 200%:** 최종 무훅 APK가 설치된 Fold7에서 기준 배율 0.9일 때 앱 기본 글꼴 14.4px, 샘플 본문 21.6px였다. 2.0으로 바꿨을 때 각각 32px, 48px가 됐고 화면을 사용할 수 있었다. 0.9로 복원한 뒤 같은 값으로 돌아왔다. Black Shark 2 탐침에서도 1.0→2.0 때 16→32px, 본문 24→48px를 측정했고 1.0으로 복원했다.

기기 전역 설정을 바꾼 항목은 `font_scale`, Black Shark 2의 회전 고정과 야간 모드였다. 각 기기에서 시작 값을 먼저 기록하고 원래 값으로 되돌린 뒤 다시 읽어 확인했다. 최종 확인 값은 Black Shark 2 `font_scale=1.0`, night mode no, 자동회전 1/회전 0이며 Fold7 `font_scale=0.9`, night mode yes, window rotation lock 0이다. 다른 사용자 프로필은 건드리지 않았다.

## 생산 앱 및 저장 데이터 경계

생산 패키지 `app.narou.reader`는 테스트 전후 두 기기에 설치되어 있는지만 패키지 목록으로 확인했다. 생산 APK는 설치하지 않았고 생산 앱을 실행하지 않았으며 생산 패키지 데이터에 쓰기·삭제 명령을 보내지 않았다. 독서 데이터의 전후 파일 목록·해시는 수집하지 않았으므로 **저장 데이터의 바이트 단위 동일성은 검증하지 않았다**. 별도 테스트 패키지의 설정·상태만 사용했다.

## 다른 검사와 제한

제품 코드 변경 후 Android CI와 Checks가 성공했다. 이 #92 작업에서 수행한 전체 vitest 병렬 실행은 920개 중 919개 통과, `batch-translation.test.tsx`의 시간 제한 테스트 1개가 실패했다. 같은 테스트 단독 실행은 통과했고, 해당 기존 batch flake는 별도 이슈 #101로 추적한다. APK 정적 감사, 빌드, 설치·실기 동작은 서로 다른 결과로 판정했다.

화면 캡처·APK·임시 diff·CDP 측정 스크립트·SDD 판정 원문은 Git에 넣지 않았다. 로컬 보존본은 기본 checkout의 `.superpowers/verification-92-final/` 아래에 있다. 문서와 metadata는 설치 소스 `6ff31b8`에 덧붙인 결과 기록이며, 이 문서 커밋은 APK 소스 커밋과 분리한다.
