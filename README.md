<div align="center">
  <picture>
    <img alt="JHF Novel Reader" src="docs/assets/brand-logo.png" width="120">
  </picture>

  <h1>JHF Novel Reader</h1>
  <p>내 PC의 로컬 AI로 일본 웹소설을 번역해, 휴대폰에서 쾌적하게 읽는 Android 앱</p>
</div>

<div align="center">

[![릴리스][release-shield]][release-url]
[![Android][android-shield]][release-url]
[![MIT 라이선스][license-shield]][license-url]
[![검사][checks-shield]][checks-url]

</div>

<div align="center">
  <a href="#처음-쓰기">처음 쓰기</a> &middot;
  <a href="#주요-기능">주요 기능</a> &middot;
  <a href="#개인정보와-연결">개인정보와 연결</a> &middot;
  <a href="https://github.com/earlydreamer/jhf-novel-reader/releases">다운로드</a>
</div>

---

<p align="center">
  <img src="docs/assets/screens/library-empty.png" alt="처음 연 서재 화면" width="260">
  &nbsp;&nbsp;
  <img src="docs/assets/screens/settings.png" alt="번역 서버 설정 화면" width="260">
</p>

## 개발 목적

일본 웹소설을 번역해 읽는 방법에는 저마다 제약이 있습니다.

- 외부 AI 서비스를 이용하는 번역 방식은 API 키가 필요하거나 사용량에 따라 비용이 발생할 수 있습니다.
- 웹소설을 읽을 때는 문맥에 맞는 번역과 일관된 이름 표기가 필요합니다.
- 회차마다 번역 결과와 읽던 위치를 보관하면 다시 읽기 편합니다.

JHF Novel Reader는 **내 컴퓨터의 로컬 모델**로 번역해서 이런 제약을 넘고, 작품을 쾌적하게 감상하는 것을 목표로 합니다.

## 주요 기능

- **내 PC의 로컬 모델로 번역** — OpenAI 호환 API로 동작하는 서버에 휴대폰이 직접 연결합니다. LM Studio·Ollama·llama.cpp는 주소 형식 프리셋이 준비돼 있습니다.
- **앱 안에서 찾고 바로 읽기** — 소설가가 되자·카쿠요무·pixiv를 앱 안에서 둘러보거나 작품 주소를 붙여 넣어 작품을 고르고, 회차를 누르면 번역이 시작됩니다. OpenAI 호환 서버로 번역할 때는 도착한 문단부터 보여 줍니다.
- **번역한 회차는 다시 번역하지 않습니다** — 끝까지 번역한 회차는 휴대폰에 저장됩니다. 다시 열면 저장본이 바로 열리고, 서버에 연결하지 않아도 읽을 수 있습니다.
- **미리 번역** — 범위나 전체 회차를 순서대로 번역해 둡니다. 이미 같은 설정으로 번역한 회차는 건너뜁니다.
- **작품별 용어집** — 등장인물·지명 표기를 작품마다 정해 두고 번역에 적용합니다.
  - 번역 전에 새 이름을 모아 용어집을 자동으로 만듭니다.
  - 정밀스캔으로 저장한 회차 전체를 다시 살펴 표기를 다듬습니다. 위키백과·나무위키 조회는 켜고 끌 수 있습니다.
  - 읽는 화면에서 용어를 강조해 보여 주고, 길게 눌러 바로 추가·편집·삭제합니다.
  - 선택 기능인 판정 모델(약 165MB)을 내려받으면 휴대폰에서 문맥을 분석해 애매한 이름이 해당 용어인지 판정합니다.
- **번역 확인과 다시 번역** — 일본어가 남은 문단과 용어집 표기가 빠진 문단을 알려 줍니다. OpenAI 호환 서버로 번역할 때는 문단만 골라 다시 번역할 수 있습니다.
- **읽기 화면** — 글자 크기, 줄 간격, 독서 배경(기본·세피아·검정), 다크 테마, 원문 보기를 지원하고 읽던 위치를 기억합니다. 회차 제목과 작품 제목도 번역합니다.
- **백업과 복원** — 서재·저장한 번역·용어집·읽기 위치·설정을 파일 하나로 저장하고, 새로 설치한 앱에서 복원합니다.

## 준비물

| 무엇 | 설명 |
|---|---|
| Android 휴대폰 | Android 7.0 이상, 64비트(arm64) |
| 번역 서버 | OpenAI 호환 API를 제공하는 PC. LM Studio, Ollama, llama.cpp 등으로 모델을 실행합니다. |
| 번역 모델 | 일본어→한국어 번역이 되는 모델이면 됩니다. Gemma 4 E4B로 실제 사용을 확인했습니다. |

## 처음 쓰기

1. [릴리스 페이지][release-url]에서 최신 APK를 받아 설치합니다. 처음이면 ‘출처를 알 수 없는 앱 설치’를 허용해야 합니다.
2. PC에서 번역 서버를 켜고 모델을 불러옵니다. 휴대폰이 접속할 수 있도록 신뢰하는 같은 로컬 네트워크나 이미 구성한 안전한 연결에서만 사용합니다.
3. 앱의 **설정 → 번역 서버**에 서버 주소와 포트를 입력합니다. `LM Studio 1234`·`Ollama 11434`·`llama.cpp 8080` 버튼이 주소 형식을 프리셋으로 채워 줍니다.
4. **연결 확인하기**를 누르고 번역에 쓸 모델을 선택합니다.
5. 서재 아래의 **작품 찾기**에서 소설가가 되자·카쿠요무·pixiv를 고르거나, **URL로 열기**에 해당 사이트의 작품 또는 회차 URL을 입력합니다. 목차에서 회차를 누르면 번역이 시작됩니다.

HTTP 주소를 쓰면 회차 원문과 서버 인증값이 암호화되지 않은 채 전송됩니다. 신뢰할 수 있는 HTTPS 연결을 권장하며, 앱을 쓰려고 서버 포트를 인터넷에 공개하지 않습니다. 자세한 연결 제한은 [Android 네트워크 정책](docs/android-validation.md#http-policy-and-its-limits)을 참고합니다.

## 앱 구성

| 화면 | 하는 일 |
|---|---|
| 서재 | 담아 둔 작품과 이어서 읽기 |
| URL로 열기 | 작품 또는 회차 URL을 입력해 서재에 담기 |
| 작품 | 회차 목록과 저장 상태, 용어집 편집·용어 정밀스캔·미리 번역·제목 번역 |
| 리더 | 번역 읽기, 보기 설정, 원문 보기, 번역 확인, 문단 다시 번역, 용어 강조·편집 |
| 설정 | 번역 서버와 모델, 번역 방식, 용어 정밀스캔·판정, 테마, 백업 |

## 개인정보와 연결

번역한 회차, 원문, 용어집, 읽기 위치는 휴대폰의 앱 전용 저장소에만 있습니다. 서버 인증값은 휴대폰의 보안 저장소에 따로 보관합니다. 앱 개발자가 운영하는 서버는 없습니다.

앱이 연결하는 곳은 다음이 전부입니다.

| 연결 | 언제 | 보내는 것 |
|---|---|---|
| 소설가가 되자·카쿠요무·pixiv | 작품을 찾고 회차를 열 때 | 페이지·작품 정보 요청 |
| 내 번역 서버 | 번역할 때 | 회차 원문과 번역 지시 |
| 위키백과·위키데이터 | 정밀스캔 조회를 켰을 때만 | 용어 이름 |
| 나무위키 | 정밀스캔 조회를 켰을 때만 | 용어 이름 |
| Hugging Face | 판정 모델을 내려받을 때만 | 모델 파일 요청 |

## 이전 버전(0.1.x)에서 옮기기

0.1.x는 다른 앱으로 설치돼 있어서 데이터가 자동으로 이전되지 않습니다.

1. 이전 앱을 0.1.27로 업데이트하고 **설정 → 백업 파일 만들기**로 파일을 저장합니다.
2. 새 앱의 **설정 → 백업에서 복원하기**에서 그 파일을 선택합니다.
3. 서버 인증값과 판정 모델은 백업에 들어가지 않습니다. 필요하면 다시 넣거나 내려받습니다.

## 사용 시 유의사항

- 번역 품질은 사용하는 모델에 따라 달라집니다. 앱은 남은 일본어와 빠진 용어 표기를 찾아 주지만, 뜻이 맞는지는 판단하지 못합니다.
- 공개된 회차만 읽습니다. 로그인이나 연령 확인이 필요한 회차는 열지 않습니다. pixiv는 로그인 없이 볼 수 있는 일본어 작품만 엽니다.
- 번역 결과는 개인 감상용입니다. 원문과 번역을 다시 배포하지 않습니다.

## 개발과 기여

전체 문서는 [문서 안내](docs/README.md)에서 목적별로 찾을 수 있습니다. 처음 참여한다면 [기여 안내](CONTRIBUTING.md)에서 저장소 준비와 PR 흐름을 확인합니다. [개발 환경과 검사](docs/development-checks.md)에 Node 버전, 실행 명령, 합성 미리보기와 Android 검증 경로를 정리했습니다.

화면 규칙은 [디자인 시스템](DESIGN.md), 문구 원칙은 [UX 라이팅 가이드](docs/ux-writing.md)에서 확인합니다. [디자인 시스템 미리보기](docs/design-system.html)는 컴포넌트와 상호작용을 확인하는 HTML 문서입니다. 파일을 내려받아 브라우저에서 열면 사용할 수 있습니다.

## 라이선스

앱 코드는 [MIT 라이선스](LICENSE)를 따릅니다. 소설 원문과 번역의 권리는 각 작품의 저작권자에게 있습니다. 포함된 오픈소스는 앱의 **설정 → 오픈소스 라이선스**와 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에서 볼 수 있습니다. 소설가가 되자 페이지 해석에는 [LNReader](https://github.com/LNReader/lnreader-plugins)의 Syosetu 플러그인 구조를 참고했습니다(MIT).

## 비공식 앱 안내

- JHF Novel Reader는 비공식 앱입니다.
- 소설가가 되자, 카쿠요무, pixiv의 운영사가 만들거나 배포한 앱이 아닙니다.
- 각 운영사와 관계가 없습니다.
- 사이트 사양이 바뀌면 일부 기능이 동작하지 않을 수 있습니다.
- 「小説家になろう」는 주식회사 히나프로젝트의 등록상표입니다.
- pixiv는 ピクシブ株式会社의 등록상표입니다.

[release-shield]: https://img.shields.io/badge/release-v1.0.1-5B5BD6?style=flat-square
[release-url]: https://github.com/earlydreamer/jhf-novel-reader/releases
[android-shield]: https://img.shields.io/badge/Android-7.0%2B-3DDC84?style=flat-square&logo=android&logoColor=white
[license-shield]: https://img.shields.io/badge/license-MIT-blue?style=flat-square
[license-url]: LICENSE
[checks-shield]: https://img.shields.io/github/actions/workflow/status/earlydreamer/jhf-novel-reader/check.yml?style=flat-square
[checks-url]: https://github.com/earlydreamer/jhf-novel-reader/actions/workflows/check.yml

