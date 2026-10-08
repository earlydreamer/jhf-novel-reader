# Android 실기 검증 — 작품 제거와 저장본 보존 (#94, 2026-10-08)

## APK와 소스 경계

실기 APK의 제품 코드는 `6cbc56a56ba3587c588fd7c7973c2257065ded4b` (tree `879e57875e9cb0ad65f725cd2f7018728adc4ab7`) 기준이야. 뒤이은 `d882946485d4f8ff53d06058c2c98936c769176d` (tree `49ede9ca3b24056d5f0064afb1c5c939536ae3aa`)에서는 `tests/ui/renewal-library.test.tsx`만 바뀌었고, 제품 코드 blob은 실기 APK 소스와 같아. Sol 6.1의 제품 코드 감사와 추가 회귀 감사에서 P1/P2가 없음을 확인했고, 필수 Checks와 Android CI도 통과했다. 이 근거는 코드·CI 판정이며 기기 실기 근거와 구분한다.

| 용도 | 패키지 | 출처 / SHA-256 | 판정 |
| --- | --- | --- | --- |
| 생산 패키지 ID의 clean debug APK 정적 감사 | `app.narou.reader` | clean source `6cbc56a5…` / tree `879e…`; SHA-256 `bc16fa5e9a6de2d0c644735782fc6d361125edc379435128d06dc487331a03ad` | `npm run build`, `npx cap sync android`, clean `:app:assembleDebug`, `node tests/e2e/verify-apk.mjs` 통과. Release 서명 APK가 아니며 설치하거나 실행하지 않았어. |
| 실기 APK | `app.narou.reader.devicecheck2` | 같은 제품 commit/tree에 임시 `android/app/build.gradle` debug `applicationIdSuffix '.devicecheck2'`만 적용. SHA-256 `4b13e6a7c2ad7603784bb512c0e30c1baca8fe4127808d2af3b569afe2a1af81`, 6,491,762 bytes | 네이티브 provenance `dirty:true`는 suffix 변경 하나 때문이고, 웹 provenance는 `dirty:false`. APK 내부 11개 웹 자산이 빌드 `dist`와 바이트 단위로 같아. minSdk 24, targetSdk 36, APK v2 서명 검증 통과. 인증서 SHA-256 `8c5d8712374dff61e93c2ecbcc240a17d2db4759c97ee4ab11275322aa5fe0a6`. |

테스트 APK만 KEY2와 Black Shark의 `user 0`에 설치·갱신했어. 생산 패키지, `.test`, `.devicecheck`는 설치·실행·삭제·쓰기하지 않았어. 임시 Gradle suffix는 빌드 뒤 원복했고, 문서 커밋에는 제품 코드가 없어. 생산 패키지 ID의 clean debug APK 출처 검증은 실기 APK 설치를 대신하지 않으며, 실기 검증은 생산 패키지에서 수행하지 않았어.

## 합성 데이터 검증

두 기기의 기존 `.devicecheck2` 저장소에서 유효한 최신 색인을 읽어 합성 작품 A(`n9501ab`)와 B(`n9502bc`)를 병합했어. 기존 합성 `n1020aa` 항목도 유지했어. A와 B에는 목차·완료 번역 1개·읽기 위치·최근 읽기와 제목/용어집 소유 파일을 넣었고, A의 v1 legacy 저장본은 앱을 cold restart해 실제 v2 migration이 색인에 등록되는지 확인했어. 소설 원문이나 실제 모델, 외부 서버 주소는 사용하지 않았어.

| 확인 | KEY2 (`5000337213`) | Black Shark (`67f3906b`) |
| --- | --- | --- |
| Cold restart 뒤 삭제 전 | legacy migration version이 색인에 나타났고 A는 2 versions, B는 1 version. 기존 `n1020aa`가 남아 있었어. | 같은 조건을 확인했어. |
| 닫기/시스템 Back | Home 삭제 확인 대화상자의 ‘닫기’를 눌렀어. 전후 요약 스냅샷이 같았어(색인, A 파일 잔여 수, legacy pointer, B private-file SHA 포함). | Work 화면 앱바 삭제 확인에서 시스템 Back을 보냈어. 확인창만 닫히고 목차 화면이 남았어. 전후 요약 스냅샷에서 색인·A 파일 잔여 수 요약과 B 5개 파일 SHA가 같았어. |
| A 제거 뒤 cold restart | A의 색인 work/version/recent, legacy migration version 및 legacy pointer가 사라졌어. A가 소유한 파일과 migration candidate 경로도 0개 남았어. | 같은 결과를 확인했어. 재시작 뒤 migration으로 A가 재등록되지 않았어. |
| B 보존 | 리더를 열기 전에 비교한 B 소유 private 파일 5개의 SHA가 모두 전후 동일했어. | 같은 5개 파일 SHA가 전후 동일했어. |
| 기존 합성 항목 | `n1020aa`의 색인 항목과 version/recent 존재가 유지됐어. pending removal inventory는 0이야. | 같은 결과야. |
| 보존 리더 | B 목차에서 합성 회차를 열어 합성 번역 1블록을 확인했어. | 같은 결과야. |

KEY2에서는 Home 메뉴 경로로 실제 제거했고, Black Shark에서는 Work 화면 앱바 메뉴 경로로 제거했어. 두 기기의 삭제 전 스냅샷은 migration 확인 뒤 고정했고, B SHA 비교는 리더 화면을 열어 자동 위치 저장이 일어나기 전에 수행했어. 저장 검증 helper의 CDP 결과 처리 오류는 `returnByValue` 객체 결과를 직접 받도록 고쳤고 객체/JSON 문자열 양쪽 형식의 단위 검증 8/8이 통과했어. 처음 Home 확인에서 제거 탭이 동작하지 않은 시도는 저장 상태가 그대로였고, 화면을 다시 확인한 뒤 버튼을 눌러 실제 제거를 완료했어. 이는 입력 재시도 기록이며 제품 결함으로 판정하지 않아.

## 화면과 런타임 확인

KEY2는 BlackBerry KEY2 / BBF100-6, Android 8.1.0/API 27, `arm64-v8a`, WebView `com.android.chrome 121.0.6167.178`이야. Black Shark 2 / SKW-H0는 Android 10/API 29, `arm64-v8a`, WebView `com.google.android.webview 153.0.8010.36`이야. 두 기기 모두 시스템 `font_scale=1.0`이었고 변경하지 않았어. 앱 테마를 라이트와 다크로 각각 전환한 뒤 원래 선택인 ‘시스템 설정 따르기’로 복구했어.

두 기기의 라이트 화면에서 상태 표시줄 평탄부 샘플은 RGB `(250,250,253)`, 다크 화면에서는 `(19,19,27)`이었어. 캡처에서 상단 상태 표시줄과 툴바의 분리, 라이트 배경의 어두운 상태 표시 아이콘, 다크 배경의 밝은 아이콘을 확인했어. 하단 전체 콘텐츠가 시스템 내비게이션 영역과 겹치지 않는지, 최대 스크롤 말단까지 도달하는지는 이번 캡처로 검증하지 않았어. Black Shark의 home-after-remove 캡처에서는 고정 FAB와 시스템 내비게이션 □ 아이콘의 시각적 겹침도 관찰했어. 최대 스크롤이나 상호작용은 확인하지 않았으므로 이 겹침의 접근성 영향과 원인은 판정하지 않아. 따라서 아래쪽 스크롤 콘텐츠가 시스템 바 뒤로 지나는 것이 정상 edge-to-edge인지, 마지막 버튼 접근성 문제인지는 판정하지 않아. CSS inset 수치도 측정하지 않았어.

시스템 Back은 KEY2에서 리더→목차→서재 경계, Black Shark에서 Work 화면의 삭제 확인→목차 경계를 확인했어. 양쪽 테스트 앱의 현재 PID에 한정한 `logcat -d` 오류 집계에서 `E/`, `F/`, `AndroidRuntime`, `FATAL EXCEPTION`은 각각 0줄이었어. WebView 전체 콘솔 기록이나 기기 전체 기간 로그 집계는 하지 않았고, CDP helper의 평가 예외가 없었다는 결과도 전체 콘솔 0건으로 확대하지 않아.

## 보존 범위와 제한

생산 패키지와 그 저장 데이터는 조회·변경하지 않았어. 그래서 생산 데이터의 전후 파일 해시나 바이트 동일성은 검증하지 않았어. 기기 검증은 별도 `.devicecheck2` 패키지 안에서 합성 fixture만 사용했어. 두 기기에서 확인한 `n1020aa`는 색인 요약뿐이며, 그 밖의 테스트 앱 데이터 전체를 비교한 것은 아니야. 물리 키보드 입력, 실제 번역 모델 통신, 외부 원문 페이지 탐색은 실행하지 않았어.

원시 캡처와 APK는 Git에 넣지 않았어. 로컬 무시 경로 `D:/projects/narou-reader/.superpowers/verification-94-remove-work/` 아래에 APK, provenance, 색인 스냅샷, 합성 fixture, helper와 소스 SHA가 붙은 화면 캡처를 보관했어. 각 기기의 캡처·스냅샷 SHA-256은 함께 커밋하는 `metadata.json`에 기록했어. 캡처에는 시스템 상태 표시줄 아이콘이 포함되므로 로컬 evidence 전용으로 유지해.
