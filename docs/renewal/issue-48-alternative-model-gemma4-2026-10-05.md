# #48 대안 모델 검증 — 리눅스 3070 Ti + gemma-4 E4B

2026-10-05 KST. 이전 조사([issue-48-context-limit-investigation-2026-10-05.md](issue-48-context-limit-investigation-2026-10-05.md))에서 Hy-MT2 7B의 장문 입력 붕괴를 규명한 뒤, 8GB VRAM(리눅스 서버 RTX 3070 Ti)에서 동작하는 대안 모델을 찾아 실측했다. 앱 코드·프롬프트·저장 형식은 수정하지 않았다.

## 결과 요약

**gemma-4 E4B(QAT UD-Q4_K_XL)가 리눅스 3070 Ti 8GB에서 나로우 실제 회차를 한 번의 요청으로 누락 없이 번역했다.**

| 지표 | gemma-4 E4B (3070 Ti) | Hy-MT2 7B (이전 조사) |
| --- | --- | --- |
| 소스 | n6517bw/3, 187문단/비공백 103/7,173자 | 187/103/7,258자 |
| prompt / completion tokens | **4,440 / 4,780** = 9,220 | 6,422 / 5,712 |
| finish_reason | **stop** | stop (붕괴/누락) |
| 출력 블록 | **103** (= 비공백 103, 누락 0) | 71 (28–32 누락) |
| 단서(약초/버섯/독버섯/마력) | **4 / 8 / 2 / 15 (원문 일치)** | 4/1 · 8/1 · 2/0 · 15/4 |
| 도입~결말 | 완역 | 중간 59–87 누락 |
| 소요 | 47.1초 | (붕괴) |

- gemma-4는 같은 분량을 Hy-MT2보다 약 30% 적은 토큰(4,440 vs 6,422)으로 처리했다(토크나이저 차이).
- 출력 블록 수가 비공백 문단 수와 정확히 일치하고, 누락 단서가 모두 복원됐다.

## 대안 모델 조사 (8GB / JA→KO / one-shot)

| 후보 | Q4_K_M | 컨텍스트 | 라이선스 | 8GB 판정 |
| --- | ---: | --- | --- | --- |
| **gemma-4 E4B** | 4.98GB (QAT 4.22GB) | 128K | Apache-2.0 | ✅ **실측 성공** |
| HY-MT1.5-7B | 4.62GB | 256K(config) | ⚠️한국 제외 | 기술적 유력, 라이선스 리스크 |
| Qwen3-8B | 5.03GB | 32K | Apache-2.0 | 유력 |
| NiuTrans LMT-60-8B | ~5GB | 32K | Apache-2.0 | 번역 특화 |
| Qwen3.5-4B | ~3.4GB | 262K | Apache-2.0 | 여유 |
| HY-MT1.5-1.8B | 1.1GB | 256K(config) | ⚠️한국 제외 | 품질 타협 |
| TranslateGemma | 2.5GB | **입력 2K** | Gemma | one-shot 불가 |
| Tower-Plus-9B | ~5.5GB | Gemma2 4K | CC-BY-NC | 컨텍스트·비상업 |
| Seed-X-7B | 4.35GB | 32K | OpenMDW | llama.cpp 출력 깨짐 |
| EXAONE/Kanana | ~5GB | 32K | NC/Apache | 일본어 미지원 |

- **Hy-MT2 README는 `max_context: 8192`를 명시**하고, HY-MT1.5 GGUF는 `context_length=262144`로 설정돼 있다. Hy-MT2의 붕괴는 이 8K 한도와 부합한다.
- **Gemma-4는 텍스트 MT 특화 모델이 아니지만**, Gemini-4 세대의 sliding-window/shared-KV/K=V 구조 덕분에 llama.cpp에서 KV 캐시가 작아 8GB에 적합하다. vLLM은 이 최적화가 없어 부적합하다.
- 주의: Gemma-4 세대는 long-generation repetition collapse가 알려져 있으나, 본 테스트(4,780 completion, finish=stop)에서는 발생하지 않았다.

## 리눅스 환경 구축 (Jakepark 서버, Ubuntu 26.04, RTX 3070 Ti 8GB)

- `~/llama.cpp/llama-b11146` — llama.cpp build 11146(0.5.0-dev, commit `7fe450e19`), CUDA 12.8 x64 바이너리 + cudart.
- `~/models/gemma-4-E4B-it-UD-Q4_K_XL.gguf` — 5,126,306,944 bytes, SHA-256 `3cf61de12daa015e…`(앞 16자), unsloth `unsloth/gemma-4-E4B-it-GGUF`.
- 실행: `llama-server -m <gguf> -c 16384 -ngl 99 -fa on --reasoning off --host 127.0.0.1 --port 8080`.
- **추론(thinking) 끄기**: `--reasoning off`(llama.cpp) 또는 LM Studio `reasoning_effort:"none"`. Gemma-4 정식은 기본 OFF이나, `--reasoning off`로 확실히 차단함을 확인(응답 `reasoning_content` 빈값).
- GPU 점유: 로드 시 약 3.7GB(8GB 중). ComfyUI가 점유하던 3.3GB는 실험을 위해 중지했다.
- 관련 스킬·접속: 리눅스 서버는 Tailscale SSH(추가 인증 필요) / 표준 SSH 키 인증(`jakepark-linux-fb`, port 2222) 두 경로가 있다.

## 한계와 미검증

- 단일 소스(한 회차), python 근사 파서 사용(정규 입력 7,173자 vs 앱 7,258자, ruby/공백 처리 차이). 완전한 의미 대조는 **블록 수(103=103)와 어휘 단서**로 판정했고, 정밀 문장 대조는 수행하지 않았다.
- 12B·Qwen3-8B·NiuTrans 등 나머지 후보는 미실측이다. gemma-4 E4B가 성공했으므로 12B는 품질 비교용 후속 후보다.
- 실제 narou-reader 앱 연동(openai-compatible endpoint로 llama-server 사용), 온디바이스 경로, 앱 G1 재검증은 미실시다.
- 이 테스트는 조사 목적이며 앱 계약·promptVersion(prompt를 바꾸지 않음)을 변경하지 않는다. `--reasoning off`는 런타임 설정이지 앱 계약 변경이 아니다.

## 앱 G1 재검증 — blackshark2 (2026-10-05)

리눅스 gemma-4 E4B endpoint를 실제 앱(PR #47 / 7074af8 APK)으로 연결해 end-to-end를 재검증했다.

- 기기: Black Shark 2(`SKW-H0`), Android 10(API 29), 1080x2340. `adb`로 설치·조작.
- 앱: `app.narou.reader` (MAINPC `7074af8` app-debug APK, 4,404,302 bytes).
- 설정: 제공자 "LM Studio / Ollama", API 기본 주소 `http://<tailnet-host>:8080`(Tailnet) → "연결 확인" 성공, 모델 목록에서 `/path/to/models/gemma-4-E4B-it-UD-Q4_K_XL.gguf` 선택.
- 흐름: 작품 화면(`リビティウム皇国のブタクサ姫`, 2026-10-05 목차 1–100화) → 3화 `森の修行と黒猫の使い魔` 선택 → **"이 화 번역" 1회**.
- 서버 로그: 요청 1건, `total time = 47,921 ms / 9,431 tokens`, `truncated = 0`.
- 저장: `files/narou-reader/versions/<uuid>.0.json`에 durable 저장. `payload.text` 7,967자, `payload.blocks` **103개**(원문 비공백 103과 일치).
- **누락 검증**: 저장 번역 단어 단서 **약초 4 · 버섯 8 · 독버섯 2 · 마력 15**(원문과 일치). 이전 Hy-MT2 G1은 71블록에 독버섯 0으로 28–32문단 누락이었다.
- 리더 표시 및 **오프라인 재열기**: llama-server를 중지한 뒤 앱을 재시작해도 홈 "이어 읽기"에서 저장본이 열리고 본문이 표시됐다.

**결론**: #48의 번역 누락(G1 FAIL)이 gemma-4 E4B + 리눅스 3070 Ti 조합에서 재현되지 않았고, 앱 코드 수정 없이 end-to-end가 동작했다. 남은 G1 조건은 "앱 안 검색·랭킹·분류" 경로(이번엔 회차 URL 경로 사용)이며, 검색 동작은 이전 G1에서 PASS였다.

## 다음

1. ~~리눅스 llama-server를 앱의 openai-compatible 제공자로 연결해 실제 G1을 재검증한다.~~ (2026-10-05 완료 — 위 참조)
2. ~~12B QAT와 품질·VRAM·속도를 비교한다.~~ (2026-10-05: 8GB에서 로드 불가 — 아래 참조)
3. 장기적으로 온디바이스(#49)에서 gemma-4 E2B/E4B 적합성을 검토한다.

## 추가 검증 (2026-10-05)

### 앱 내 검색 경로 G1
블랙샤크2 앱에서 作品検索 → `n6517bw` → 작품 정보 → 목차 → **4화(첫 화 아님) `開拓村の雑貨屋と誕生日の贈り物`**를 선택해 번역·저장. 저장본 `payload.blocks` **132/132**(원문 비공백 132, 누락 0), provenance는 gemma-4 모델·plain-v1. **검색→선택→번역→저장→읽기 전체가 동작**했다.

- 참고: 오프라인 재열기 테스트를 위해 앱을 force-stop한 뒤에는 연결 확인(`catalogStatus`)과 모델 선택(`selectedModelId`)이 **세션 상태로 리셋**되어 번역 버튼이 비활성화됐다. 이는 설계(저장본은 연결·모델과 독립적으로 읽힘)이며 결함이 아니다. TOC에서 회차를 선택하는 경로는 원문을 미리 로드하지 않고, 원문 fetch는 번역 실행 시점(`translate()` → `flow.start()` → `source.getChapter`)에만 일어난다. 연결을 재설정하면 정상 번역됐다.

### 12B QAT — 8GB 부적합
`gemma-4-12b-it-UD-Q4_K_XL.gguf`(7,366,423,360 bytes)를 8GB RTX 3070 Ti에 로드하면 KV 캐시 할당(1,440MiB)에서 `cudaMalloc failed: out of memory`로 실패한다. **12B는 8GB VRAM에서 구동 불가**이며, **E4B(4.22GB QAT)가 8GB의 실질 최적 후보**다.

