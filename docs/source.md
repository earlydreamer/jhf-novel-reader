# 원문 조회와 파싱

현재 원문 경로의 진입점은 `src/source/sites.ts`의 `createRenewalSource`, `normalizeSourceInput`, `normalizeWorkPageUrl`입니다. 이 모듈의 `SourceSite` 경계가 사이트별 URL 정규화, 작품·회차 식별, 목차·본문 추출, 저장 기록의 회차 ID·목차 주소 검증을 나눕니다. 나로우 구현은 `src/source/work.ts`와 `src/source/parse.ts`, 카쿠요무 구현은 `src/source/kakuyomu.ts`, pixiv 구현은 `src/source/pixiv.ts`와 `src/source/pixivText.ts`에 있습니다. 초기 이슈 #2의 `src/source/index.ts`·`NarouSourceAdapter`는 현재 진입점이 아닙니다.

## 지원 주소와 목차

### 나로우

HTTPS `ncode.syosetu.com/nNNNNx[x]/` 작품·단편 주소와 `/nNNNNx[x]/<positive-safe-integer>/` 회차 주소를 지원합니다. 호스트·작품 코드의 대소문자와 끝 슬래시를 정규화하고 fragment를 제거합니다. 인증 정보, 비기본 포트, 점 경로, 이스케이프 경로, 공백·제어 문자, 다른 프로토콜·호스트와 성인용 호스트는 거부합니다. 작품 정보 페이지 `/novelview/infotop/` 대신 작품의 정규 주소를 사용합니다.

작품 목차에는 양의 안전한 정수인 `?p=` 페이지만 허용합니다. 회차 주소로 들어오면 회차 선택을 유지하면서 작품 주소에서 메타데이터를 가져옵니다. 다음 목차 링크는 같은 작품의 더 큰 페이지 번호만 허용합니다. 단편도 작품 메타데이터 조회만으로 본문 번역을 시작하지 않습니다.

### 카쿠요무

HTTPS `kakuyomu.jp/works/<ID>` 작품 주소와 `/works/<ID>/episodes/<ID>` 회차 주소를 지원합니다(#371). 끝 슬래시와 fragment를 제거하고, 쿼리·인증 정보·비기본 포트·다른 호스트·점 경로·이스케이프 경로는 거부합니다. 작품·회차 ID가 `Number.MAX_SAFE_INTEGER`를 넘을 수 있어 `Number`로 바꾸지 않고 숫자 문자열로 유지합니다. 저장 기록의 작품 ID는 `kakuyomu-<작품 ID>`, 회차 ID는 `kakuyomu-<작품 ID>/<회차 ID>`이며 나로우 형식과 겹치지 않습니다.

목차는 작품 페이지 한 장의 `__NEXT_DATA__` Apollo 상태에서 실행 없이 JSON으로 읽습니다. `Work.tableOfContentsV2` 그룹 순서와 각 그룹의 `episodeUnions` 순서를 따르고, 읽는 순번 `ordinal`은 목차 위치(1부터)로 정합니다. 사이트 ID와 순번은 서로 대신하지 않습니다. 회차 중복, 없는 참조, 다른 작품의 상태, 빈 목차는 `source_parse`로 거부합니다. `publicEpisodeCount`는 필수이며, 양의 안전한 정수이고 목차 회차 수와 일치해야 합니다. 누락되거나 잘못된 형식이면 완전한 목차로 저장하지 않습니다. 목차 그룹 제목은 아직 회차 제목에 붙이지 않습니다.

본문은 `.widget-episodeBody`의 문단, 제목은 `.widget-episodeTitle`, 이전·다음 회차는 `#contentMain-readPreviousEpisode`·`#contentMain-readNextEpisode`에서 읽습니다. 빈 줄 문단 `<p class="blank"><br></p>`와 `<rb>` 루비는 나로우와 같은 계약으로 보존합니다.

원문 브라우저 프로필(`SourceSites`)의 허용 호스트는 `kakuyomu.jp`와 `cdn-static.kakuyomu.jp`입니다. 카쿠요무 페이지 스크립트는 검색 조건·정렬 화면에서 GraphQL을 GET으로 부릅니다. 이 요청은 Apollo의 CSRF 방지 헤더가 없으면 400을 받습니다(2026-10-24 확인). 그래서 요청 헤더 허용 목록에 `Content-Type`(`application/json`만), `apollo-require-preflight`, `x-apollo-operation-name`을 둡니다.

### pixiv

로그인 없이 읽히는 일본어 작품만 지원합니다(#390). 주소는 두 가지입니다.

- 시리즈: HTTPS `www.pixiv.net/novel/series/<ID>`
- 회차·단독 작품: `www.pixiv.net/novel/show.php?id=<ID>`

`pixiv.net`도 같은 주소로 정규화합니다. 끝 슬래시와 fragment는 제거합니다. `id` 외의 쿼리, 0으로 시작하는 ID, 인증 정보, 포트, 점 경로, 이스케이프 경로는 거부합니다. 정규 주소에 쿼리가 들어가는 사이트라서, 저장 검증은 사이트가 정규 주소로 인정한 쿼리 주소만 받습니다(`isQueryCanonicalUrl`).

식별자는 다음과 같습니다. 시리즈 번호와 소설 번호가 겹칠 수 있어서 작품 ID에 `s`·`n`을 붙여 나눕니다.

- 시리즈 작품 ID: `pixiv-s<시리즈 ID>`
- 단독 작품 ID: `pixiv-n<소설 ID>`
- 회차 ID: `<작품 ID>/<소설 ID>`

`show.php` 주소만 보고는 단독 작품인지 시리즈 회차인지 알 수 없습니다. 그래서 작품을 열 때 본문 API를 먼저 조회하고, 시리즈에 속하면 시리즈를 열어 그 회차를 선택합니다. 조회 전에는 `sourceWorkId`가 `null`을 돌려줍니다.

작품 페이지는 본문이 없는 SPA라서 다음 JSON API를 읽습니다.

- 본문: `/ajax/novel/<ID>`
- 시리즈 정보: `/ajax/novel/series/<ID>`
- 시리즈 목차: `/ajax/novel/series/<ID>/content_titles`

응답은 상태 200, 최종 URL 일치, `application/json`이어야 합니다. 원문 보관 필드 `rawHtml`에는 받은 JSON을 담습니다.

목차 개수가 `publishedContentCount`와 다르거나 ID가 중복되면 완전한 목차로 저장하지 않습니다. `available: false` 회차는 목차에서 빼고, 공개 회차에 1부터 빈칸 없는 순번을 매깁니다.

다음은 `source_unsupported`로 거부하고 전용 안내를 보여 줍니다.

- `isLoginOnly` 작품
- `xRestrict`·`maxXRestrict`가 0이 아닌 작품
- `language`가 `ja`가 아닌 작품

없는 작품은 404 JSON(`error: true`)이 와서 `source_access`로 처리합니다. 회차의 시리즈가 저장된 참조와 다르면 `source_parse`로 거부합니다. 회차가 다른 시리즈로 옮겨졌거나 단독 작품이 시리즈에 들어간 경우가 여기에 해당합니다.

본문 마크업은 줄마다 문단 하나로 바꾸고, 빈 줄은 빈 문단으로 남깁니다.

- `[[rb:본문 > 읽기]]`는 루비가 됩니다.
- `[newpage]`는 빈 문단이 됩니다.
- `[chapter:제목]`은 제목 문단이 됩니다.
- `[jumpuri:제목 > URL]`은 제목만 남깁니다.
- `[jump:N]`과 삽화 태그는 제거합니다.
- 깨지거나 모르는 태그는 글자 그대로 둡니다.

pixiv 원문 요청 사이에는 최소 2초 간격을 둡니다(`SOURCE_HOST_MIN_INTERVAL_MS`). 원문 전송은 요청을 한 줄로 세워 보내고, 공통 1초와 호스트별 간격 중 긴 쪽을 직전 요청 시각부터 잽니다. 한 화 번역, 일괄 번역, 용어 후보 스캔, 새 회차 확인에 모두 적용됩니다. pixiv 브랜드 가이드라인이 크롤러 같은 프로그램으로 작품을 수집하는 행위와 서버에 극단적인 부하를 주는 행위를 금지하기 때문입니다.

원문 브라우저 프로필의 허용 호스트는 `www.pixiv.net`, `s.pximg.net`, `i.pximg.net`, `embed.pixiv.net`입니다. `i.pximg.net`의 표지·삽화 이미지는 Referer가 없으면 403을 받습니다(2026-10-28 확인). 그래서 요청 헤더 허용 목록에 `Referer`를 두되, 값은 출처 `https://www.pixiv.net/`만 허용합니다. 페이지 경로나 검색어가 담긴 전체 주소는 보내지 않습니다. 태그 목록 화면은 시작할 때 `localStorage`를 읽다가, 저장소가 없으면(`null`) 멈춥니다(2026-10-28 확인). 그래서 pixiv 프로필은 메모리 저장소를 켭니다. 아래 원문 브라우저 절을 참고합니다. 가이드라인에 따라 설정의 오픈소스 라이선스 화면에 "pixiv가 만들거나 배포한 앱이 아님"을 표기합니다.

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

## 원문 브라우저

앱 안 원문 브라우저(`SourceBrowserActivity`)는 앱 브리지가 없는 별도 WebView입니다. 사이트의 검색·정렬·필터·랭킹 전환이 동작하도록 사이트 스크립트를 실행합니다. 대신 페이지가 시작하는 HTTP 요청은 모두 `shouldInterceptRequest`를 거쳐 `SourceBrowserLoader`가 처리합니다. WebView의 직접 네트워크 접근은 막혀 있습니다.

loader 경계는 다음과 같습니다.

- GET만 보냅니다. 쿠키와 인증값은 보내지 않습니다.
  - Capacitor는 WebView 쿠키 저장소를 쓰는 전역 `CookieHandler`를 항상 등록하고, `HttpURLConnection`은 이를 사용합니다. loader는 생성될 때 이 handler를 `SourceBrowserCookies`로 감쌉니다. 그래서 프로필 호스트 요청은 쿠키를 읽거나 저장하지 않습니다. 앱 본체의 다른 요청은 기존 handler를 그대로 씁니다.
- 리디렉션은 단계마다 사이트 프로필의 허용 호스트인지 검사합니다.
  - WebView 응답은 3xx를 표현할 수 없습니다. 메인 프레임 요청이 다른 주소에서 끝나면, 그 요청의 응답으로 스크립트 없는 페이지를 돌려줍니다. 이 페이지는 지연 0초 `meta refresh`로 최종 주소를 열고, 이 이동도 loader를 거칩니다. 응답이 그 내비게이션에 속하므로 늦게 끝난 이전 요청이 현재 페이지를 바꾸지 않습니다. 프래그먼트만 다른 요청(뒤로 가기의 `/novel#discover` 등)은 리디렉션으로 보지 않습니다.
- 응답에는 `Cache-Control: no-store`, CSP, 원 서버의 `Access-Control-Allow-Origin`만 남깁니다.
- CSP는 `connect-src <모든 프로필 호스트>; worker-src 'none'; object-src 'none'`입니다. 스크립트를 허용하지 않는 프로필과 프로필 밖 응답에는 `script-src 'none'`을 덧붙입니다.
  - `connect-src`는 프로필 밖 호스트로 가는 WebSocket을 막습니다. CSP 규칙상 `https://호스트`는 같은 호스트의 `wss:`도 허용하므로, 프로필 호스트로 가는 WebSocket은 loader를 거치지 않고 WebView 네트워크와 쿠키 저장소로 연결될 수 있습니다. 이 경로는 아래 잔여 위험으로 감수했습니다.
  - `worker-src 'none'`은 서비스 워커와 워커 생성을 막습니다.
- 서비스 워커 요청은 `WebViewClient`가 아니라 프로세스 전역 client로 갑니다. 원문 브라우저는 열릴 때 모든 서비스 워커 요청을 403으로 막는 client를 등록합니다. 이 client는 Capacitor Bridge가 등록한 client를 대체하며, 앱 본체는 서비스 워커를 쓰지 않습니다.
- 페이지 요청 헤더는 그 사이트 프로필의 허용 목록에 있는 이름·값만 전달합니다. 다른 프로필로 리디렉션되면 버립니다. `Cookie`·`Authorization`은 허용 목록에 넣을 수 없습니다.

다음 두 경로는 loader를 거치지 않으며 2026-10-24에 잔여 위험으로 감수했습니다.

- **WebRTC:** loader 밖에서 UDP로 통신할 수 있고, CSP나 WebView 설정으로 막을 수 없습니다.
- **프로필 호스트로 가는 WebSocket:** CSP는 `https:`와 `wss:`를 나눠 허용할 수 없습니다. `connect-src`를 막으면 사이트의 fetch·XHR(카쿠요무 GraphQL 등)까지 막혀 탐색이 깨집니다. 연결 상대는 프로필 호스트로 한정되며, WebView 쿠키 저장소의 해당 사이트 쿠키(페이지가 직접 만든 값)가 함께 전송될 수 있습니다.

두 경로 모두 실행 주체는 허용 호스트의 자체 스크립트이며, 광고·분석 스크립트는 허용 호스트가 아니라서 받지 않습니다. 원문 브라우저에는 로그인과 앱 데이터가 없고, loader는 쿠키를 보내지 않습니다. 페이지 스크립트가 `document.cookie`나 IndexedDB에 남긴 값은 WebView 저장소에 남을 수 있습니다.

2026-10-24 KEY2(Android 8.1, WebView 121) 실험에서 이 경계 없이 JS를 켜면 WebSocket·서비스 워커·WebRTC가 loader를 우회했습니다. CSP와 서비스 워커 client를 적용하자 외부 호스트 WebSocket과 서비스 워커는 막혔고 WebRTC는 남았습니다. 재측정에서는 프로필 호스트로 가는 `wss://syosetu.com/`도 CSP가 막았습니다. KEY2(WebView 121)와 Black Shark 2(Android 10, WebView 155)에서 같은 결과였습니다. CSP 규칙상 다른 WebView 버전에서는 허용될 수 있으므로 잔여 위험 항목은 유지합니다.

DOM 저장소는 모든 사이트에서 끕니다(`setDomStorageEnabled(false)`). 메모리 저장소를 켠 프로필(현재 pixiv)의 문서에는 문서 시작 스크립트(`WebViewCompat.addDocumentStartJavaScript`)가 메모리 `localStorage`를 넣습니다. 허용 출처는 그 프로필의 호스트입니다. 값은 그 문서 안에만 있고, 페이지를 옮기거나 다시 불러오면 사라집니다. WebView 프로필의 디스크에는 남지 않습니다. 문서 시작 스크립트를 지원하지 않는 WebView에서는 `localStorage`가 `null`인 채로 둡니다.

로그인, POST가 필요한 기능(팔로우·북마크·리뷰), 쿠키나 저장소에 오래 남는 값이 필요한 기능(검색 이력 등)은 지원하지 않습니다.

### 사이트 추가 절차

사이트별 차이는 Java `SourceSites`의 프로필 하나에 모읍니다. 프로필 항목은 허용 호스트, 시작 주소, 작품 선택 규칙, 요청 헤더 허용 목록, 스크립트 허용, 메모리 저장소입니다. 브라우저·loader 코드는 고치지 않습니다.

1. **파서:** 작품·회차 URL 정규화와 목차·본문 파서를 구현합니다.
2. **프로필:** `SourceSites.ALL`에 프로필을 추가하고, 같은 `id`·시작 주소·호스트를 `src/platform/browseSites.ts`의 `BROWSE_SITES`에 표시 이름과 함께 추가합니다. 두 목록의 일치는 `tests/contracts/browse-sites.test.ts`가 검사합니다. 허용 호스트에는 사이트 자체 출처와 정적 자원 출처만 넣고 광고·분석·SNS 호스트는 넣지 않습니다.
3. **실기 측정:** 기기에서 검색·정렬·필터·랭킹 기간·랭킹 장르·페이지 넘김·'이 작품 열기'를 확인하고, 요청 기록에서 4xx를 찾습니다. 페이지 스크립트가 요구하는 요청 헤더가 있으면 허용 목록에 최소한으로 추가합니다. 스크립트를 켜면 오히려 깨지는 사이트는 스크립트 허용을 끕니다. `localStorage`가 없어서 멈추는 화면이 있으면 메모리 저장소를 켭니다.
4. **검증 기록:** 측정한 동작, 기기, WebView 버전을 PR에 적습니다.

## 출처와 검증 한계

선택자의 상위 프로젝트 리비전과 MIT 고지는 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)에 있습니다. 초기 파서 테스트는 새로 작성한 합성 자료와 모의 전송을 사용했습니다. 해당 테스트가 실제 소설의 이용 권한이나 공개 배포 권한을 부여하지 않습니다. 실제 이용에는 접근 허용 범위와 콘텐츠 권리를 따로 확인합니다.

원문 파서의 외부 자원 비활성화, 원문 브라우저 경계, 네이티브 전송, 실제 기기 동작은 [Android 검증](android-validation.md)의 버전별 증거로 판단합니다. 기본 검사는 `npm ci`, `npm run typecheck`, `npm test -- --run`, `npm run build`입니다.
