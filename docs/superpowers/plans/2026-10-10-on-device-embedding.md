# 기기 임베딩(EmbeddingGemma 2) 판정 옵션 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 설정에서 켜면 EmbeddingGemma 2(텍스트 270M, LiteRT-LM)를 사용자 기기에 내려받아 설치하고, 용어 매칭 중 **후보(경계가 애매한) 매칭**이 그 용어를 가리키는지 문맥 임베딩으로 판정한다. 끄거나 설치 전이면 규칙만으로 동작한다(용어 처리 재설계 계획의 후보 조건 문구).

**Architecture:** 네이티브 플러그인 `OnDeviceEmbedding`(LiteRT-LM `EmbeddingEngine`)이 모델 파일 다운로드·검증·로드·`embed(texts)`를 맡고, 웹 쪽 `termDecision.ts`가 후보 매칭 자리의 앞뒤 문맥과 그 용어의 '확정 문맥'(같은 입력·저장된 정밀스캔 근거)을 임베딩해 코사인 유사도로 확정/제외/보류를 정한다. 판정은 번역 요청 전 한 번, 회차의 후보 자리를 모아 한 번에 임베딩한다.

**Tech Stack:** Android LiteRT-LM(`com.google.ai.edge.litertlm:litertlm-android`, 버전은 Task 0에서 고정), Capacitor 플러그인(Java), TypeScript.

**Spec:** `docs/superpowers/specs/2026-10-10-term-pipeline-review.md` §3 C. 선행: `docs/superpowers/plans/2026-10-10-term-pipeline-redesign.md`(후보 매칭이 있어야 판정 대상이 생긴다).

## Global Constraints

- 사용자 결정(2026-10-10): EmbeddingGemma 2는 **사용자 기기에서 선택적으로** 돌린다. 설정 토글, 기본 끔. 서버에서 돌리지 않는다.
- 모델은 APK에 넣지 않는다. 켤 때 확인 대화상자(크기·저장 위치·출처)를 거쳐 내려받는다.
- **중지와 제거를 모두 지원한다(사용자 요구 2026-10-10).**
  - 중지: 토글을 끄면 즉시 판정에 쓰지 않고, 메모리에 올린 모델을 해제(엔진 close)하며, 진행 중인 다운로드·판정을 취소한다. 파일은 남겨 다시 켜면 바로 쓴다.
  - 제거: 설정에 설치된 모델 크기와 `모델 지우기` 버튼을 둔다(확인 대화상자). 파일을 지우고 엔진을 해제한다. 토글이 켜져 있으면 함께 끈다.
- 모델 출처: Hugging Face `litert-community/embeddinggemma-2-text-270m-litert-lm`(Apache-2.0, 공개). 다운로드 주소는 정확한 파일 URL 하나만 허용하고, SHA-256으로 검증한다(값은 Task 0에서 고정).
- 추론은 float32 또는 bfloat16. float16 금지(EmbeddingGemma 2 활성값 범위 초과로 NaN·품질 저하).
- 판정 실패(모델 없음·로드 실패·시간 초과)는 번역을 막지 않는다. 규칙 결과(후보 조건 문구)로 진행한다.
- 새 Gradle 의존성은 LiteRT-LM 하나만. 라이선스 고지(`THIRD_PARTY_NOTICES.md`, 앱 라이선스 화면)에 LiteRT-LM과 모델(Apache-2.0)을 더한다.
- 원문 문맥은 기기 안에서만 쓴다(외부 전송 없음).

---

### Task 0: 확인 실험(spike) — 결과로 이 계획의 빈 값을 고정

**목표:** 아래를 실제로 확인해 이 계획 문서의 "Task 0 결과" 절에 적는다. 앱 코드는 바꾸지 않는다(별도 실험 브랜치, 병합 안 함).

- [ ] Google Maven에서 `com.google.ai.edge.litertlm:litertlm-android`의 최신 안정 버전과, 그 AAR에 `EmbeddingEngine`·`EmbeddingEngineConfig`·`InputData.Text`·`computeEmbedding`이 있는지 확인(AAR 클래스 목록).
- [ ] 우리 Gradle/AGP·minSdk·compileSdk(36)와 호환되는지 빌드 확인. APK 크기 증가(arm64-v8a) 측정.
- [ ] 모델 파일 정확한 URL(`.../resolve/<commit>/<file>.litertlm`), 크기, SHA-256 확인(로그인 없이 받히는지).
- [ ] Fold7에서 최소 실험 앱(또는 이 앱의 실험 브랜치)으로: 모델 로드 시간, 128토큰 텍스트 1개·16개·64개 임베딩 시간(CPU·GPU), 메모리 사용.
- [ ] 판정 실험(오프라인, PC): n0421du 1화의 후보 매칭 예(リスト in クリストファー, 魔王 in 魔王城)와 확정 매칭 문맥으로 유사도 분포를 보고 임계값 초안을 정한다(PC는 `litert-lm` Python 또는 ONNX 버전 사용).

**Task 0 결과(2026-10-10, 일부):**
- 라이브러리: `com.google.ai.edge.litertlm:litertlm-android:0.18.0`(2026-10-06 배포, EmbeddingGemma 2와 같은 날). AAR에 `EmbeddingEngine`, `EmbeddingEngineConfig`, `EmbeddingOptions`, `EmbeddingResponse`, `computeEmbeddingAsync`·`computeEmbeddingBatchAsync`가 있다. minSdk 24(우리와 같음). 전이 의존성: gson 2.14.0, kotlin-reflect 2.4.0, kotlinx-coroutines-android 1.11.0.
- 네이티브 크기: `liblitertlm_jni.so` arm64-v8a 22.2MB(gzip 9.7MB), x86_64 26.4MB. 현재 APK 9.0MB.
  - 판정: `abiFilters 'arm64-v8a'`만 넣는다(실사용 기기는 arm64, 에뮬레이터 x86_64 미지원 감수). 예상 APK 약 +22~25MB(라이브러리 비압축 저장 + Kotlin 런타임).
- 모델: `https://huggingface.co/litert-community/embeddinggemma-2-text-270m-litert-lm/resolve/9be6e8b90982095dc05c2bd162e4b954ee4dbac7/embeddinggemma-2-text-270m.litertlm`, 164,626,432바이트, SHA-256 `2d079ee2f6f066b1f368e8d7c819f55214eaef1d0513b312321901f30ab286fb`, Apache-2.0, gated 아님. (Tensor G5/G6 전용 파일은 쓰지 않는다.)
- 남은 확인: Fold7 로드 시간·배치 지연·메모리, 백엔드(CPU/GPU) 선택, 임계값 초안 → Task 1 구현물로 실측해 채운다.

### Task 1: 네이티브 플러그인 — 다운로드·검증·로드·임베딩

**Files:** Create `android/app/src/main/java/app/narou/reader/OnDeviceEmbeddingPlugin.java`; Modify `MainActivity.java`(registerPlugin), `android/app/build.gradle`(의존성 1개).
- 메서드: `status() → { installed, bytes, loaded, downloading }`, `download() → 진행 이벤트(progress {received,total})`, `cancelDownload()`, `unload()`(엔진 close, 파일 유지), `remove()`(진행 중 다운로드 취소 → 엔진 close → 파일·임시 파일 삭제), `embed({ texts: string[] }) → { vectors: number[][] }`(로드 안 됐으면 로드).
- 다운로드: Task 0의 정확한 URL만, `HttpURLConnection`, 임시 파일 → SHA-256 확인 → `files/narou-reader-models/`로 원자적 이동. 실패·불일치 시 임시 파일 삭제.
- 로드: 첫 `embed`에서 지연 로드, 앱 백그라운드 시 해제. `Backend`는 Task 0 결과(CPU/GPU) 기준.
- 임베딩 입력: `task: clustering | query: ` 접두(모델 카드 규칙, Task 0에서 확정) + 문맥, 양끝 공백 제거. 출력 L2 정규화, Matryoshka 256차원으로 자른다(Task 0 결과로 확정).

### Task 2: 웹 플랫폼 계층과 설정

**Files:** `src/platform/embedding.ts`(플러그인 래퍼, 웹 미리보기는 없음 처리), `src/storage/settings.ts`(`onDeviceEmbedding?: boolean`), 컨트롤러 설정 메서드, `SettingsScreen.tsx`.
- 설정 섹션 '용어 판정'에 스위치 `기기에서 용어 판정 모델 쓰기` / 설명 `애매한 이름이 그 용어인지 문맥으로 가려요. 모델(약 165MB)을 기기에 내려받아 기기 안에서만 써요.`
- 켤 때 확인 대화상자(크기·출처·Wi-Fi 권장) → 다운로드 진행 표시(`중단` 버튼 = `cancelDownload`) → 완료.
- 끄기(중지): 바로 `unload()`, 진행 중이던 판정·다운로드 취소. 파일은 남는다.
- 설치돼 있으면 항목 `설치된 판정 모델 · {크기}` + `모델 지우기`(확인 대화상자 `판정 모델을 지울까요? 다시 쓰려면 다시 내려받아야 해요.`) → `remove()`, 토글 끔.

### Task 3: 판정 모듈과 번역 흐름 연결

**Files:** Create `src/translation/termDecision.ts`; Modify `src/translation/guidance.ts`(후보를 확정·제외로 바꿀 수 있는 입력), `src/translation/wholeChapter.ts`(번역 전 판정 단계, 시간 제한).
- `decideCandidates(input, applied, embed, options) → Map<name, 'confirm' | 'reject' | 'keep'>`:
  - 후보 자리마다 앞뒤 40자 문맥, 그 용어의 확정 자리 문맥(같은 입력)과 정밀스캔 근거 문맥이 있으면 기준으로 쓴다.
  - 기준과의 최대 코사인 ≥ 상한 → confirm, ≤ 하한 → reject, 사이·기준 없음 → keep(Task 0 임계값).
- wholeChapter: 설정이 켜져 있고 모델이 설치돼 있으면 번역 요청 전에 회차의 후보를 한 번에 판정(시간 제한 3초). confirm은 확정 이름으로(표기 검사 대상), reject는 참고 목록에서 뺀다. 실패·시간 초과는 그대로 진행.
- 해시: 판정은 적용 해시에 넣지 않는다(재설계 계획의 해시 규칙 유지).

### Task 4: 고지·실측

- `THIRD_PARTY_NOTICES.md`·라이선스 화면에 LiteRT-LM·EmbeddingGemma 2 추가.
- Fold7 실측: 다운로드·설치·회차당 판정 시간, 후보 판정 정확도(n0421du 1~3화 수동 라벨 소량), 끄기·삭제.
