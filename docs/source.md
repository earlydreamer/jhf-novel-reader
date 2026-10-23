# 원문 조회와 파싱

현재 원문 경로의 진입점은 `src/source/sites.ts`의 `createRenewalSource`, `normalizeSourceInput`, `normalizeWorkPageUrl`입니다. 이 모듈의 `SourceSite` 경계가 사이트별 URL 정규화, 작품·회차 식별, 목차·본문 추출, 저장 기록의 회차 ID·목차 주소 검증을 나눕니다. 나로우 구현은 `src/source/work.ts`와 `src/source/parse.ts`, 카쿠요무 구현은 `src/source/kakuyomu.ts`에 있습니다. 초기 이슈 #2의 `src/source/index.ts`·`NarouSourceAdapter`는 현재 진입점이 아닙니다.

## 지원 주소와 목차

### 나로우

HTTPS `ncode.syosetu.com/nNNNNx[x]/` 작품·단편 주소와 `/nNNNNx[x]/<positive-safe-integer>/` 회차 주소를 지원합니다. 호스트·작품 코드의 대소문자와 끝 슬래시를 정규화하고 fragment를 제거합니다. 인증 정보, 비기본 포트, 점 경로, 이스케이프 경로, 공백·제어 문자, 다른 프로토콜·호스트와 성인용 호스트는 거부합니다. 작품 정보 페이지 `/novelview/infotop/` 대신 작품의 정규 주소를 사용합니다.

작품 목차에는 양의 안전한 정수인 `?p=` 페이지만 허용합니다. 회차 주소로 들어오면 회차 선택을 유지하면서 작품 주소에서 메타데이터를 가져옵니다. 다음 목차 링크는 같은 작품의 더 큰 페이지 번호만 허용합니다. 단편도 작품 메타데이터 조회만으로 본문 번역을 시작하지 않습니다.

### 카쿠요무

HTTPS `kakuyomu.jp/works/<ID>` 작품 주소와 `/works/<ID>/episodes/<ID>` 회차 주소를 지원합니다(#371). 끝 슬래시와 fragment를 제거하고, 쿼리·인증 정보·비기본 포트·다른 호스트·점 경로·이스케이프 경로는 거부합니다. 작품·회차 ID가 `Number.MAX_SAFE_INTEGER`를 넘을 수 있어 `Number`로 바꾸지 않고 숫자 문자열로 유지합니다. 저장 기록의 작품 ID는 `kakuyomu-<작품 ID>`, 회차 ID는 `kakuyomu-<작품 ID>/<회차 ID>`이며 나로우 형식과 겹치지 않습니다.

목차는 작품 페이지 한 장의 `__NEXT_DATA__` Apollo 상태에서 실행 없이 JSON으로 읽습니다. `Work.tableOfContentsV2` 그룹 순서와 각 그룹의 `episodeUnions` 순서를 따르고, 읽는 순번 `ordinal`은 목차 위치(1부터)로 정합니다. 사이트 ID와 순번은 서로 대신하지 않습니다. 회차 중복, 없는 참조, 다른 작품의 상태, 빈 목차는 `source_parse`로 거부합니다. `publicEpisodeCount`는 필수이며, 양의 안전한 정수이고 목차 회차 수와 일치해야 합니다. 누락되거나 잘못된 형식이면 완전한 목차로 저장하지 않습니다. 목차 그룹 제목은 아직 회차 제목에 붙이지 않습니다.

본문은 `.widget-episodeBody`의 문단, 제목은 `.widget-episodeTitle`, 이전·다음 회차는 `#contentMain-readPreviousEpisode`·`#contentMain-readNextEpisode`에서 읽습니다. 빈 줄 문단 `<p class="blank"><br></p>`와 `<rb>` 루비는 나로우와 같은 계약으로 보존합니다.

### 목차 연결

범위·전체 회차 번역은 목차 페이지를 연결해 대상을 확인합니다. 순환·중복·누락·다른 작품 링크는 거부합니다. 초기 구현의 “목차 첫 페이지만 조회하며 페이지 이동은 없음”이라는 제한은 현재 일괄 번역에 적용되지 않습니다. [일괄 번역](renewal/batch-translation.md)을 확인합니다.

## 전송과 본문 추출

인증값이 없는 `SourceTransport`를 사용하고 전송 전에 리디렉션을 차단합니다. 상태가 200이 아니거나 최종 URL이 다르면 실패합니다. HTML 콘텐츠 유형과 문자열 본문을 확인하고 요청 전·네이티브 응답 뒤에 취소 여부를 검사합니다. 로그인·성인 인증·CAPTCHA·접근 차단 우회는 제공하지 않습니다.

차단 화면 검사는 `inertFragment`에서 하고, 실행하지 않는 구조화 데이터가 필요한 사이트만 이 단계에서 JSON script를 읽습니다. 본문은 script·style·외부 자원을 제거한 `documentFragment`에서 읽습니다. 분리된 HTML template 안에서 파싱하여 이미지·프레임 같은 외부 자원이 활성 문서에 삽입되지 않게 합니다. 반환한 문자열은 화면에서 텍스트로 표시하며 HTML로 실행하지 않습니다. 문단 순서, 빈 문단, `<br>` 줄바꿈, 일본어 전각 들여쓰기는 보존하고 가장자리의 ASCII 서식 공백은 제거합니다.

루비 읽기는 본문과 분리하고 UTF-16 범위로 표시합니다. 연속된 본문·읽기 쌍을 지원하지만 복잡한 그룹, 중첩 루비, `rtc`는 읽기를 조용히 버리는 대신 `source_parse`로 거부합니다. 전서·후서는 지정한 선택자 범위에서 제외합니다.

제목·본문 누락, 복수 본문 후보, 빈 내용, 누락될 비문단 텍스트, 깊이 256 초과, 노드 100,000개 초과, 입력 2,000,000자 초과를 거부합니다. 알려진 접근 제한 제목·양식·도전 화면은 `source_access`로 처리합니다. 모든 미래 차단 화면을 알아볼 수 있다고 보장하지 않습니다.

## 식별자와 스냅샷

`parseChapter(html, url)`은 네트워크 없이 동작하는 비동기 파서입니다. 문단 ID는 회차 식별자·순서·정규화한 본문·루비를 포함하므로 같은 문장도 위치가 다르면 구분됩니다. 원문 해시는 정규 URL과 순서가 있는 본문·루비를 대상으로 하며 제목·추적 속성·실행 가능한 마크업은 포함하지 않습니다. SHA-256에는 Web Crypto를 사용합니다.

현재 조회 결과는 파싱한 회차와 함께 `captureKind`, 조회 시각 `fetchedAt`, 원문 `rawHtml`을 가진 `SourceSnapshot`입니다. 원문을 보관한다는 사실이 화면에 HTML로 삽입하거나 실행한다는 뜻은 아닙니다.

## 출처와 검증 한계

선택자의 상위 프로젝트 리비전과 MIT 고지는 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)에 있습니다. 초기 파서 테스트는 새로 작성한 합성 자료와 모의 전송을 사용했습니다. 해당 테스트가 실제 소설의 이용 권한이나 공개 배포 권한을 부여하지 않습니다. 실제 이용에는 접근 허용 범위와 콘텐츠 권리를 따로 확인합니다.

WebView 자원 비활성화, 네이티브 전송, 실제 기기 동작은 [Android 검증](android-validation.md)의 버전별 증거로 판단합니다. 기본 검사는 `npm ci`, `npm run typecheck`, `npm test -- --run`, `npm run build`입니다.
