# #95 작품 목차 화면 구현·검증 기록 (2026-10-08)

## 결과와 출처

이슈 [#95](https://github.com/earlydreamer/narou-reader/issues/95), PR [#108](https://github.com/earlydreamer/narou-reader/pull/108). 기본 main `b4e4d6ef6a195b6cdaf8d1dfd51f60c597ddd242`에서 전용 `codex/95-work-screen`을 사용했다. 구현 Luna high, 사용자 지정 독립 감사 GPT-6.1 Sol high다.

작품 목차를 앱바·단일 본문 h1·원제·완전/부분 목차 메타·실제 저장 개수·이어 읽기·회차 목록으로 재구성했다. 주 회차 버튼은 기존 회차 선택, 형제 더보기/contextmenu는 공용 시트로 연결한다. 제목 key/source/origin과 작품·현재 목차·회차 원문 URL을 보존했다. 용어집과 미리 번역은 전체 화면 대화상자로 옮기고 현재 작품이 소유한 배치 진행 카드를 유지한다.

최종 제품·빌드 소스는 `b7e3297358294f2ed1857b01ca81b52aba8de6af`, tree `874f2b128bf83e4508e74d5043f846c5810f5174`다. 기능 수정 `f15cc0e`, 회귀 포함 `e63b852` 이후 제품 변경은 fullscreen 간격과 원문 링크 터치 영역을 고치는 application.css 두 건뿐이다. 이후 문서 커밋과 최종 PR head는 설치 APK 출처와 구분한다.

## 이어 읽기·소유권·대화상자 계약

이어 읽기는 현재 작품의 recent, version source, position 소유권을 검증한다. recent 없음·성공한 null version·source 소유 불일치는 캡처한 현재 목차의 최소 ordinal로 fallback한다. 유효한 저장본의 정상 null position은 같은 저장본의 처음 위치를 연다. I/O·corrupt 오류에서는 fallback/POST 없이 안내와 재검증만 제공한다. 재검증만으로 route나 회차 선택을 실행하지 않는다. 검증된 실제 recent만 행 강조·aria-current·입장 scroll에 사용하며, 현재 목록 밖의 recent를 다른 행으로 대체하지 않는다. Home continueReading(versionId) 계약은 유지한다.

keepMounted는 목차 용어집·미리 번역 대화상자에만 적용했다. 같은 owner의 초안·범위·후보 선택을 보존하고 owner 변경 시 초기화한다. 닫힌 대화상자는 native open·aria-modal·Back 등록을 제거하고 hidden/inert로 포커스·접근성에서 제외한다. 기본 Dialog/Sheet closed unmount 계약은 유지한다. 용어집 헤더 저장은 기존 save guard/실패 초안 보존 경로를 사용한다. 기존 공통 제거, 배치 전역 guard, 명시적 시작, 저장만 재시도 경로를 유지한다.

## 코드 감사와 자동 검증

Sol이 실제 코드·회귀·artifact를 독립 검토했다. complete 목차 개수를 최대 ordinal로 표시하는 P2는 unique chapterId 수로 수정했다. 작품 B 준비 실패가 이전 작품 A record에 오류를 표시하는 P2는 별도 errorWorkId로 소유권을 유지했다. 준비/후보 확인·검증 재시도 중 모델 POST 0회와 기존 오류/저장 경로를 회귀로 확인했다.

Chromium 실측에서 발견한 fullscreen P2도 수정했다. `.nr-work-screen > * + *`가 Dialog에 margin-top16px을 적용해 y16+height844=bottom860(vh844)을 만들었다. overlay를 :where(:not(.nr-modal))로 flow 간격 대상에서 제외해 specificity를 유지했다. 다음 시각 감사에서 발견한 원문 링크 높이24px은 해당 anchor에 flex 정렬과 최소 터치 영역48px만 추가했다. DOM·URL·controller·저장·native 경로는 바꾸지 않았다.

e63 전체 Vitest 78 files/1003 tests, 관련 8 files/143 tests PASS. 4eeda 관련94 tests+application-css5 tests, b7의 application-css5 tests와 typecheck/lint/format 검사 PASS. e63 JSON의 138 suites는 중첩 그룹을 포함하며 실제 파일 수는78이다. 초기 세 테스트 실패는 회차 접근성 이름과 완료 단계 대기 조건을 기존 단언을 유지하며 수정했다. worktree 초기 의존성/cordova.variables.gradle 부재는 npm ci/android:sync 뒤 해결한 빌드 준비 문제다.

최종 b7 [Checks37726541613](https://github.com/earlydreamer/narou-reader/actions/runs/37726541613)와 [Android37726541626](https://github.com/earlydreamer/narou-reader/actions/runs/37726541626)은 모두 SUCCESS다. root가 실제 head b7 일치와 Checks 로그의 78 files/1003 tests PASS를 확인했다. Web production build·Android assembleDebug/assembleDebugAndroidTest 컴파일은 통과했다. CodeRabbit automatic reviews disabled/review skipped는 독립 감사 근거가 아니다. 실행 테스트/CI는 구현자·CI와 root 관측 근거이며 Sol은 테스트를 재실행하지 않고 실제 소스·회귀·artifact/증거를 감사했다.

별도 removal-generation 지연 완료 테스트, readWork/corrupt 각 경로의 새 개별 테스트를 모두 추가했다고 주장하지 않는다. route→Home 지연 null 회귀와 storage validator/catch/guard 코드 감사 범위를 구분한다.

## 최종 APK 정적 근거

승인된 합성 시험 APK만 설치한다. 패키지 `app.narou.reader.devicecheck2`, min24/target36, MainActivity `app.narou.reader.MainActivity`, v2 서명 검증 성공/signer1, 인증서 SHA-256 `8c5d8712374dff61e93c2ecbcc240a17d2db4759c97ee4ab11275322aa5fe0a6`.

최종 suffix APK는 6,495,562 bytes, SHA-256 `554e66b12265d7d4fb931a3b831b6ef8b5115f5050b0d96891f1b4657f99da43`. 실제 native/web commit/tree는 b7/874f이며 web dirty=false, native dirty=true는 임시 applicationId suffix 때문이다. Gradle 원본 SHA `ce5351f1d2a993fde3b1cb82db3029ee3e32e0c059caa4a79b9c414115283abd`로 복원·tracked clean을 확인했다.

실제 dist11개는 APK public 자산과 byte-identical이고 Capacitor 생성0-byte cordova.js/cordova_plugins.js 두 개를 포함한 public13개를 확인했다. 이전4eeda와 최종9 DEX 전부 byte-identical이다. 앞선 e63부터의 DEX 비교와 actual classes7 descriptor는 #106 SystemBars.injectSafeAreaCSS(WindowInsetsCompat, boolean) 패치 유지를 뒷받침한다.

생산 ID APK는 e63 단계에서 컴파일·정적 감사만 하고 설치하지 않았다. 그때 생산/시험 APK ZIP463개 중 manifest/resources/native provenance만 달랐고 모든 DEX/public 내용은 동일했다. 이는 e63 pair의 비교 결과이며 최종 b7 생산 APK 비교로 확대하지 않는다. 최종 생산 빌드는 해당 CI로 별도 판정한다. AndroidTest .test APK도 컴파일만 했고 설치하지 않았다. 기존 .devicecheck2.insetsprobe.test는 변경하지 않았다.

## Chromium 최종 검증

최종 b7 source/tree/clean을 시작·종료 모두 확인한 실제 Application/controller 합성 trial이다. Chrome154.0.8037.97/Node24.19.0/Vite5197/CDP9227에서 라이브러리·제목·용어집 저장소는 실제 코드의 in-memory backend를 사용했다. batch 상태는 합성 mock이므로 실제 배치 pipeline 성공으로 확대하지 않는다. PNG15장과 metadata, fixture/driver를 root ignored verification-95-work-screen/b7e329…/chromium에 보존했고 전용 Vite/Chrome만 종료했다.

360/412/600 CSS px×light/dark6조합에서 Pretendard 로드 완료·테마·가로 overflow 없음·본문 h1 하나·부분목차101~114·고유 저장2화·실제recent109 강조/초기 scroll을 확인했다. CTA와 행 메뉴 및 앱바 유효 hit area는48px이고 앱바 메뉴8항목은 각각192×48px이며 viewport clipping이 없다.

최종 회차 sheet 원문 링크는360×48px, sheet는360×844 viewport에서 y600/height244/bottom844, maxscroll0/clipping없음이다. 전체 화면 용어집은412×844/y0/margin0/bottom844이며200% rootfont32px에서도 가로overflow없다. reduced-motion reduce에서 전환·animation0s를 확인했다. 실제 합성 입력으로 원문·표기·말투 초안을 변경하고 Escape/Back으로 닫았다 다시 열어도 보존됐고, 저장하지 않은 repository는 기존 값을 유지했다. 닫힌 keepMounted는 open제거/hidden/inert/displaynone/aria-modal제거, 내부programmaticfocus차단과AX이름미노출을 확인했다.

native dialog의 Tab trail에서 BODY/일부document.hasFocusfalse 뒤 내부컨트롤복귀가 나타났으나 실제 배경interactivecontrol누수는0이었다. 문서 밖 browser UI 경계에 부합한다는 추론과 구체적 주소창 초점 직접 관측을 구분한다. fresh 제목focus와 내부복귀/펼친폼focus에서Escape닫힘을 확인했으며16Tab직후Escape가 항상 닫힌다고 확대하지 않는다. 외부요청 원본0/차단0이며 오류0은 활성 Console.messageAdded/Runtime.exceptionThrown 수집 범위에 한정한다.

이전4eeda final-run-2는 source·metadata·PNG가 일치하는 부분 검증 자료이나 anchor24px 미충족을 포함해 최종 완료 근거에서 제외한다. e63 중간 폴더는 source guard가 캡처 뒤에 있어 일부PNG가 덮였을 가능성이 있으므로 PNG와metadata를 일치하는 최종 묶음으로 사용하지 않는다. 당시 고정 실패metadata/CSS 원인과 직접 관측만 구분해 보존했다. 최종 b7 runner는 capture전/종료 sourceguard 및 새 출력 경로를 사용한다.
## 양기기 실기·보존

최종 b7 suffix APK를 KEY2(Android 8.1/API27, 활성 Chrome WebView121.0.6167.178)와 Black Shark2(Android10/API29, WebView153.0.8010.36)의 `.devicecheck2`에 유지 업데이트했다. 설치된 package path에서 pull한 양기기 APK는 모두 최종 6,495,562 bytes/SHA554e66…99da43과 일치한다. 생산/다른 시험 패키지는 실행·설치·삭제·저장 데이터 조회하지 않았다. 합성 B(n9502bc)와 n1020aa만 사용했다.

저장 리더→작품 Back과 recent aria-current 복원, 용어집 초안의 Back/같은 owner 재열기 보존, 배치 패널 닫기/같은 owner 재열기 및 owner 변경 초기화를 관측했다. 연결 부재로 배치 입력이 disabled였으므로 DOM 경유 range 관측을 실제 사용자 입력 성공으로 계산하지 않는다. 배치 시작·스캔·확정 및 모델/번역 요청은 실행하지 않았다. 원문 링크는 열지 않고 위치·48px 터치 영역만 확인했다.

| 관측 | Black Shark2 | BlackBerry KEY2 |
| --- | --- | --- |
| 전체 화면 rect y / margin-top / bottom gap | 0 / 0 / 0 CSS px | 0 / 0 / 0 CSS px |
| 전체 화면 크기 | 392.727×850.909 CSS px | 412.19×594.286 CSS px |
| 회차 sheet 링크 높이 | 48 CSS px | 48 CSS px |
| IME 표시 전→표시→Back 숨김 viewport 높이 | 851→548→851 CSS px | 594→554→594 CSS px |
| Android 시스템 font_scale | 2.0 시험→1.0 복원 | 2.0 시험→1.0 복원 |
| 시험 시 body computed font size | 32px, CSS/DOM 주입 없음 | 32px, CSS/DOM 주입 없음 |
| 허용 저장 경로 | 19개, 변경0 | 19개, 변경0 |
| 합성 저장 fixture | 5개 해시 보존 | 5개 해시 보존 |

최종 before/after 비교는 설치 직전 새 baseline을 사용했다. fontScale·회전·시스템 night mode 등 가능한 설정을 원래 값으로 복원했고, MainActivity와 합성 Home 복귀를 확인했다. e63 최초 baseline과 후속 업데이트 전 비교도 변화0이었으나 중간 소스의 실측을 최종 결과로 대체하지 않는다. Luna가 소유한 ADB forward9237/9238을 제거하고 남은 해당 포트0을 확인했다.

최종 `devicecheck2-final-runtime.json` SHA-256은 `d846a249430b1224b98c4bbb31edd48a2b8bbdb190e4675b4fa4ae0c1fe6c75b`다. root는 명시된 PNG15개 각각의 bytes/SHA를 다시 대조했고 불일치0을 확인했다. root ignored 증거 폴더에 JSON·APK·합성 PNG를 보존했다. 제한된 현재 PID 로그 집계는 Black PID29372/178줄, KEY2 PID756/370줄이며 원문을 저장하지 않았다. 이 줄 수를 오류0 또는 전체 로그 정상의 증거로 확대하지 않는다.

실제 모델 통신/번역 의미·말투 품질, 물리 키 타이핑과 TalkBack 실제 탐색은 미실행이다. Chromium 오류0은 수집한 Runtime.exceptionThrown/Console.messageAdded 범위다.

## 전달 상태

제품·APK·Chromium·양기기 실기 검증을 마쳤다. 독립 최종 증거 감사, 문서 커밋을 포함한 최종 PR head CI, 병합과 브랜치/worktree 정리 및 기본 main readback은 전달 절차에서 확인한다. 설치 APK 출처 b7과 후속 문서 head를 구분한다. 로컬 Vault 기록과 NAS 동기화는 별개이며 NAS는 확인하지 않았다.
