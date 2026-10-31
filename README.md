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
  <a href="#이용-방법">이용 방법</a> &middot;
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

브라우저 내장 번역 기능은 번역 결과물의 일관성이 보장되지 않고, 유료 API는 비용이 발생합니다. JHF Novel Reader(이하 앱)은 유료 API 이외에도 본인이 보유한 다양한 수단으로 일본 웹소설을 번역해서 읽을 수 있는 뷰어를 지향합니다.

## 주요 기능

- **내 PC의 로컬 모델로 번역** — OpenAI 호환 API로 동작하는 서버에 휴대폰이 직접 연결합니다. LM Studio·Ollama·llama.cpp는 주소 형식 프리셋이 준비돼 있습니다.
- **앱 안에서 찾고 바로 읽기** — 소설가가 되자·카쿠요무·pixiv를 앱 안에서 둘러보거나 작품 주소를 붙여 넣어 작품을 고르고, 회차별로 번역합니다.
- **미리 번역** — 범위나 전체 회차를 순서대로 번역해 둡니다. 이미 같은 설정으로 번역한 회차는 건너뜁니다.
- **작품별 용어집** — 등장인물·지명 표기를 작품마다 정해 두고 번역에 적용합니다.
  - 번역 전에 새 이름을 모아 용어집을 자동으로 만듭니다.
  - 정밀스캔으로 저장한 회차 전체를 다시 살펴 표기를 다듬습니다. 위키백과·나무위키 조회는 켜고 끌 수 있습니다.
  - 읽는 화면에서 용어를 강조해 보여 주고, 길게 눌러 바로 추가·편집·삭제합니다.
  - 선택 기능인 판정 모델(약 165MB)을 내려받으면 휴대폰에서 문맥을 분석해 용어가 적절하게 사용되었는지 판정합니다.

## 실행을 위해 필요한 것

| 도구 | 설명 |
|---|---|
| Android 휴대폰 | Android 7.0 이상, 64비트(arm64) 지원하는 휴대폰 |
| 번역 서버 | OpenAI 호환 API를 제공하는 서버 |
| 번역 모델 | 일본어→한국어 번역이 가능한 모델 |

번역 모델의 경우, 모델의 동작 방식에 따라 정상적으로 동작하지 않을 수 있습니다. 개발 시 테스트한 환경은 Gemma 4 E4B 기반입니다.

## 이용 방법

1. [릴리스 페이지][release-url]에서 최신 APK를 받아 설치합니다. 처음이면 ‘출처를 알 수 없는 앱 설치’를 허용해야 합니다.
2. PC에서 번역 서버를 켜고 모델을 불러옵니다. 휴대폰이 접속할 수 있도록 신뢰하는 같은 로컬 네트워크나 이미 구성한 안전한 연결에서만 사용합니다.
3. 앱의 **설정 → 번역 서버**에 서버 주소와 포트를 입력합니다. `LM Studio 1234`·`Ollama 11434`·`llama.cpp 8080` 등 알려진 기본 포트를 프리셋으로 지원합니다.
4. **연결 확인하기**를 누르고 번역에 쓸 모델을 선택합니다.
5. 서재 아래의 **작품 찾기**에서 소설가가 되자·카쿠요무·pixiv를 고르거나, **URL로 열기**에 해당 사이트의 작품 또는 회차 URL을 입력합니다.
6. 목차에서 회차를 눌러 들어가면 번역이 시작됩니다.
7. 메뉴에서 미리 번역하기, 회차 제목 번역 등 추가 기능을 사용할 수 있습니다.

## 앱 구성

| 화면 | 하는 일 |
|---|---|
| 서재 | 담아 둔 작품과 이어서 읽기 |
| URL로 열기 | 작품 또는 회차 URL을 입력해 서재에 담기 |
| 작품 | 회차 목록과 저장 상태, 용어집 편집·용어 정밀스캔·미리 번역·제목 번역 |
| 리더 | 번역 읽기, 보기 설정, 원문 보기, 번역 확인, 문단 다시 번역, 용어 강조·편집 |
| 설정 | 번역 서버와 모델, 번역 방식, 용어 정밀스캔·판정, 테마, 백업 |

## 개인정보와 연결

번역한 회차, 원문, 용어집, 읽기 위치 등 앱 내에서 사용되는 데이터를 서버에 보관하지 않습니다. 앱 개발자는 데이터 저장을 위한 별도의 서버를 운영하지 않습니다.

앱이 사용자에게 정보를 제공하기 위해 다음과 같은 사이트에 연결할 수 있습니다.

| 연결 사이트 | 연결 시점 | 보내는 정보 |
|---|---|---|
| 지정된 번역 서버 | 번역할 때 | 회차 원문과 번역 지시 |
| 소설가가 되자·카쿠요무·pixiv | 작품을 찾고 회차를 열 때 | 페이지·작품 정보 요청 |
| 위키백과·위키데이터 | 정밀스캔 조회를 켰을 때만 | 용어 이름 |
| 나무위키 | 정밀스캔 조회를 켰을 때만 | 용어 이름 |
| Hugging Face | 판정 모델을 내려받을 때만 | 모델 파일 요청 |

번역 서버와의 연결은 사용자가 입력한 프로토콜과 주소를 그대로 사용합니다. HTTP, HTTPS 양쪽 프로토콜로 연결을 지원하지만 신뢰할 수 있는 HTTPS 연결을 권장합니다. 앱의 자세한 연결 제한은 [Android 네트워크 정책](docs/android-validation.md#http-policy-and-its-limits)을 참고 부탁드립니다.

## 사용 시 유의사항

- 앱은 소설가가 되자, 카쿠요무, pixiv 등 앱에서 표시하는 각 사이트의 운영사와 관계없는 비공식 제품입니다.
- 앱은 소설가가 되자, 카쿠요무, pixiv 플랫폼에 공개된 정보를 읽어 표시합니다.
- 앱을 통해 수집되는 콘텐츠의 저작권은 각 콘텐츠의 권리자에게 있습니다. 번역된 결과는 개인 감상용으로만 이용하여야 합니다.
- 각 플랫폼의 이용 약관, API 정책 및 기타 규정에 따라 발생하는 책임은 사용자에게 있습니다.
- 개발자는 앱 사용으로 인해 발생할 수 있는 저작권 침해, 서비스 이용 제한 등 법적·행정적 문제에 대해 책임지지 않습니다.
- 권리자의 요청이 있을 경우, 예고 없이 앱의 공개가 중단될 수 있습니다.
- 앱은 공개된 회차만 읽으며 로그인이나 연령 확인이 필요한 회차를 열지 않습니다.
- 번역 품질은 사용한 모델에 따라 달라지며, 번역 결과의 정확성을 보장하지 않습니다.

## 개발과 기여

다음 정책 및 가이드에 기반해 기여를 받습니다.

- [문서 안내](docs/README.md)
- [기여 안내](CONTRIBUTING.md)
- [개발 환경과 검사](docs/development-checks.md)
- [디자인 시스템](DESIGN.md) / [디자인 시스템 미리보기](docs/design-system.html)
- [UX 라이팅 가이드](docs/ux-writing.md)

## 라이선스

앱 코드는 [MIT 라이선스](LICENSE)를 따릅니다.

앱의 **설정 → 오픈소스 라이선스**와 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에서 전체 오픈소스 라이선스를 확인하실 수 있습니다.

[release-shield]: https://img.shields.io/badge/release-v1.0.1-5B5BD6?style=flat-square
[release-url]: https://github.com/earlydreamer/jhf-novel-reader/releases
[android-shield]: https://img.shields.io/badge/Android-7.0%2B-3DDC84?style=flat-square&logo=android&logoColor=white
[license-shield]: https://img.shields.io/badge/license-MIT-blue?style=flat-square
[license-url]: LICENSE
[checks-shield]: https://img.shields.io/github/actions/workflow/status/earlydreamer/jhf-novel-reader/check.yml?style=flat-square
[checks-url]: https://github.com/earlydreamer/jhf-novel-reader/actions/workflows/check.yml
