# 화면 문서 안내

화면 디자인과 UX의 정본은 다음 문서예요.

- [`DESIGN.md`](../DESIGN.md): 색 토큰, 타이포그래피, 컴포넌트, 해요체 UX 라이팅 규칙
- [`docs/superpowers/specs/2026-10-08-ui-design-system-design.md`](superpowers/specs/2026-10-08-ui-design-system-design.md): 화면별 구조와 Android UX 결정(서재·목차·몰입형 리더·설정·원문 탐색)

## 합성 미리보기와 테스트

`npm run dev -- --host 0.0.0.0`로 실행한 뒤 `/tests/ui/renewal-preview.html`을 열어요. 테스트 고정 데이터만 쓰는 390 × 844 휴대폰 미리보기라 실제 번역 요청을 보낼 수 없고, 제품 진입점은 이 파일을 import하지 않아요. 테스트는 jsdom과 Testing Library로 실행하며 원문 사이트나 모델에 접속하지 않아요. 좁은 화면 확인은 Android 실기 검증과 별개예요.
