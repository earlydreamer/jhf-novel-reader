# 앱 구조와 초기 계약의 범위

## 현재 실행 경로

Android를 우선 지원하는 React·TypeScript·Vite 앱을 Capacitor로 패키징합니다. 휴대전화가 원문 조회·파싱·모델 요청·앱 전용 저장을 담당합니다. PC에서는 사용자가 이미 설치한 Ollama·LM Studio 등의 서버를 사용합니다. 운영자 백엔드나 프록시, PC 동반 프로그램을 전제로 하지 않습니다.

현재 진입점은 `src/app/bootstrap.tsx`이며, 백업 복구와 인증 참조 정리를 마친 뒤 `createNativeRenewalApplication`을 실행합니다. `src/app/compose.ts`에서 `createRenewalController`, 원문 어댑터, 모델 세션, 서재, 번역·일괄 작업을 조합합니다. 공유 계약은 `src/contracts`에 있습니다. 초기 이슈 #1·#6의 `src/jobs` 기반 엔진과 다음 한 화 선행 번역은 현재 실행 경로가 아닙니다.

현재 동작은 [앱 통합](integration.md), 로컬 스트리밍, [범위·전체 회차 번역](renewal/batch-translation.md), [저장소](storage.md)를 함께 확인합니다. Gemini 구현은 남아 있지만 현재 설정 UI에서는 숨겨져 있습니다. [Gemini 문서](gemini-provider.md)는 구현 경계를 설명합니다.

## 도구와 검증 명령

실제 버전은 `package.json`과 `package-lock.json`을 기준으로 확인합니다.

- React/React DOM 19.3.0, TypeScript 7.0.2, Vite 8.3.2, React Vite 플러그인 6.1.1, Vitest 5.0.3을 사용합니다.
- Capacitor core/Android/CLI 8.5.2, App 8.1.2, Filesystem 8.1.4, Preferences 8.0.1을 사용합니다.
- 프로젝트의 Node 범위는 `^22.22.2 || ^24.15.0 || >=26.0.0`이며 `.nvmrc`와 CI는 24.21.0을 사용합니다. 초기 기반 검증의 Node 24.19.0은 과거 실행 환경입니다.
- Android 기준은 minSdk 24, compile/target SDK 36, Java 21입니다. APK·기기 검증은 웹 테스트와 별도입니다.
- jsdom과 Testing Library는 개발용 합성 테스트에 사용합니다. 운영 파서는 WebView DOM을 사용하며 웹 요청 프록시를 두지 않습니다.

기본 명령은 `npm ci`, `npm run typecheck`, `npm test -- --run`, `npm run build`입니다. 웹·네이티브 의존성을 바꾸면 `npm run android:sync`를 실행합니다. 최신 점검 항목은 [개발 점검](development-checks.md)을 확인합니다.

## 원문·모델·화면의 경계

원문은 정규화한 URL과 작품·회차 식별자, 순서가 있는 문단, 루비, 원문 해시로 표현합니다. 루비 범위는 UTF-16 문자열의 끝을 포함하지 않는 인덱스입니다. 문단 식별자는 회차·순서·본문·루비에 기반하므로 다른 위치의 같은 문장이 구분됩니다. SHA-256 연산에는 안전한 실행 환경의 Web Crypto가 필요합니다.

원문과 모델 결과를 HTML로 실행하지 않습니다. 모델이 반환한 URL이나 지시문으로 추가 도구를 실행하지 않습니다. 현재 스트리밍 경로는 검증 중인 일부 문단을 화면에 표시할 수 있지만, 저장 전 상태와 실패 문단을 완성된 저장본과 구분합니다. 초기 계약의 “완성 전에는 아무 번역도 표시하지 않음”은 현재 화면 전체에 적용되지 않습니다.

작업을 시작할 때 연결·모델·인증 참조·작품 지침을 고정하고, 이동·설정 변경·취소로 오래된 작업이 현재 상태를 덮어쓰지 못하게 합니다. 인증값은 일반 화면 상태나 설정 본문에 넣지 않습니다. 인증 참조의 보존·회수는 [인증값 보존](renewal/credential-retention.md)에 따릅니다.

## HTTP와 취소

원문 전송에는 모델 인증 헤더를 전달하지 않습니다. 원문은 HTTPS와 지원 호스트·경로만 허용합니다. 모델 전송은 사용자가 선택한 연결을 사용하며, Gemini는 별도의 고정 Google 목적지·키 헤더 경계를 적용합니다. 실패했다고 다른 제공자로 전환하지 않습니다.

직접 `CapacitorHttp.request`를 사용하는 전송은 네이티브 전용입니다. 브라우저 대체 전송과 전역 fetch/XMLHttpRequest 패치는 사용하지 않습니다. 네이티브 요청을 보내기 전에 리디렉션을 차단하고, 응답의 최종 URL도 확인합니다. 초기 검토에서는 Capacitor 8.5.2 Android 구현이 `setInstanceFollowRedirects(false)`를 호출하는 것을 확인했습니다. 응답 뒤 URL 비교만으로 인증 유출을 막을 수 있다고 가정하지 않습니다. [공식 HTTP 문서](https://capacitorjs.com/docs/apis/http)를 참고합니다.

JavaScript 취소는 원격 서버의 처리 취소를 보장하지 않습니다. 이미 보낸 요청의 결과가 불명이면 중복 처리 가능성을 안내하고 자동 재전송하지 않습니다. 네이티브 요청 슬롯은 실제 종료까지 유지합니다. 네이티브 읽기 시간 제한은 비활성 시간 기준이므로 총 실행 시간을 보장하지 않습니다. 스트리밍 전송의 별도 구현·검증 범위는 스트리밍 문서를 확인합니다.

`loggingBehavior: 'none'`으로 디버그 APK에서도 브리지 인자 로깅을 막습니다. 진단에는 허용한 이벤트·코드·숫자만 남기고 원문, 키, 인증 헤더, 사설 주소, 원시 예외를 복사하지 않습니다.

## 보안 저장소

`@aparajita/capacitor-secure-storage` 8.0.1을 사용합니다. Android는 Keystore와 AES-GCM 암호화 SharedPreferences를, iOS 구현은 Keychain을 사용합니다. 라이브러리의 iOS 구현이 앱 전체의 iOS 지원을 뜻하지는 않습니다.

1. 네이티브 Android/iOS 여부를 플러그인 호출 전에 검사합니다. 웹 구현은 평문 localStorage이므로 대체 수단으로 사용하지 않습니다.
2. 고정된 앱 전용 접두사와 문자열용 `getItem`/`setItem`을 사용합니다.
3. iCloud 동기화를 끄고 iOS 접근 수준을 `KeychainAccess.whenUnlockedThisDeviceOnly`로 설정한 뒤 기록합니다. 삭제·재설치 후 Keychain 값이 반드시 사라진다고 보장하지 않습니다.
4. Android 암호화 설정 파일은 `WSSecureStorageSharedPreferences.xml`입니다. 앱은 백업 및 Android 12+ 기기 이전 제외 규칙을 둡니다. 실제 복원 동작과 하드웨어 기반 키 여부는 기기 증거가 필요합니다.
5. 오류를 평문 저장으로 우회하지 않습니다.

[유지관리자 문서](https://github.com/aparajita/capacitor-secure-storage)와 [Android 백업 지침](https://developer.android.com/identity/data/autobackup)을 참고합니다.

## 초기 계약 기록과 검증 한계

이슈 #1의 초기 `ChunkRequest`·`Checkpoint`·`CacheIdentity`는 문단 ID JSON 번역과 v1 저장 형식을 위한 계약이었습니다. 정규화한 원문 URL·원문 해시·제공자·주소·모델·프롬프트 버전·언어 방향을 캐시 키에 포함하고 비밀값은 제외했습니다. 검증된 청크만 체크포인트에 넣고, 전체 회차 저장이 끝난 뒤 준비 상태를 알렸습니다. 이 기록을 현재 세션·버전 저장 구조와 혼용하지 않습니다.

웹 빌드·합성 테스트는 실제 Android 실행, LAN 연결, Keystore 복원, 전원 손실 내구성을 입증하지 않습니다. 초기 #8은 후속 #25·#28 검증으로 대체되었습니다. 부분 기기 증거와 미완료 항목은 [Android 검증](android-validation.md)을 확인합니다. 원문 이용 권한과 공개 배포 판단은 기술 테스트와 별도로 검토합니다. 프로젝트 라이선스는 저장소의 `LICENSE`를 기준으로 확인합니다.
