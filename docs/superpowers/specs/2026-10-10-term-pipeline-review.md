# 용어 처리 설계 재검토 (2026-10-10)

> 상태: 검토 초안. 사용자와 방향을 정한 뒤 이슈로 나눈다.
> 계기: n0421du 1화에서 `ち → 루시아나` 항목 때문에 문단이 반복 실패하고 엉뚱한 이름이 끼어들었다(#235). 원인은 용어집 이름을 **부분 문자열로 찾아 자리표시로 단순 치환**하는 구조다.

## 1. 지금 구조와 실제 실패

| 단계 | 지금 동작 | 관찰된 실패(근거) |
|---|---|---|
| 찾기 | 원문에 용어집 원문이 **포함**되면 매칭(`matchedNames`, 긴 이름 먼저, 단어 경계 없음) | `ち`가 ちょっと·持ち·立ち 안에서 매칭. `リスト`가 クリストファー 안, `希`가 希望 안에서 매칭될 수 있음 |
| 적용(읽으며 번역) | 매칭된 이름을 `__ENT_n__`으로 치환해 모델에 보내고, 응답의 자리표시를 표기로 복원 | 'ち' 포함 문단 21개 중 7개 실패(미포함 253개 중 1개). 통과한 12개에는 '용모 루시아나을'처럼 이름이 끼어듦 |
| 적용(일반 번역) | 매칭된 항목을 참고 목록으로 프롬프트에 넣음 | 치환이 없어 단어가 깨지지 않음 |
| 검증 | 자리표시 개수가 다르면 그 문단 실패, 가나 잔존·누락 표기(`missingTerms`) 기록 | 자리표시 검증이 실패 원인을 '번역 실패'로만 남겨 사용자가 원인을 알 수 없음 |

치환은 #82(10-08)에서 작은 모델(E4B)이 사용자가 확정한 이름을 바꾸지 못하게 하려고 넣었다. 그동안 '용어집이 일관성을 잡는다'는 실험 결과도 치환을 켠 상태에서 나왔다.

## 2. 레퍼런스 요약

**용어 강제 방식 비교(기계번역 연구)**
- **자리표시·태그 치환:** NMT 시대에 쓰였고 효과는 있었지만, 형태 정보 주석이나 학습된 처리가 필요했다(WMT21 SYSTRAN·Lingua Custodia TAG+MASK). 세 가지 강제 방식을 비교한 연구에서는 모두 용어 적용에는 효과가 있었지만 유창성 저하가 남았다(EAMT 2023).
- **제약 디코딩:** 특정 토큰을 강제로 생성하게 하면 문장이 깨질 수 있다(WMT19). OpenAI 호환 로컬 API에서는 쓰기도 어렵다.
- **LLM 프롬프트 주입 + 사후 보정:** WMT25 용어 과제는 대부분 LLM 기반이고, 프롬프트 주입(in-context)·코드 스위칭 프롬프트·용어 정확도를 함께 보는 디코딩이 주류다. WMT23에서는 누락된 용어를 정렬로 찾아 다시 생성하거나 LLM으로 후편집해 재현율을 크게 올렸고 전체 품질 저하는 작았다. **올바른 용어집만 주면** 품질과 용어 정확도가 함께 오른다(WMT25 findings).
- **문맥으로 모호성 해소:** 용어마다 설명을 붙여 프롬프트에 넣으면 LLM이 용어 뜻을 훨씬 잘 가린다(MedCT 2025). 관례를 따라야 하는 용어와 문맥에 따라 달라지는 용어 사이의 긴장은 여전히 남는다(Kim et al. 2024).

**소설 번역 도구**
- 웹소설 번역 확장(llm-novel-translator): 시리즈별 용어집을 자동으로 만들고 매 호출에 주입한다. 용어 추출은 싼 모델, 번역은 좋은 모델로 나눌 수 있다. 치환은 쓰지 않는다.
- 책 번역 사례(블로그, 일화성): 용어집을 매 호출에 넣어 이름 불일치가 약 15%에서 2% 미만으로 줄었다고 보고했다.

**결정(판정) 단계에 쓸 수 있는 도구**

| 도구 | 하는 일 | 크기·속도 | 비고 |
|---|---|---|---|
| 글자 종류 경계 규칙 | 이름이 가타카나·한자 덩어리 **전체**와 일치할 때만 매칭 | 0, 즉시 | 결정적. 한자 이름+접미(伯爵家)는 놓침 |
| TinySegmenter | 사전 없는 통계 분절 | 약 23KB JS | 정확도 제한. 숫자는 글자 단위로 쪼개짐 |
| Lindera·Sudachi(WASM) | 사전 기반 형태소 분석 | 사전 수 MB 이상 | 가장 정확. APK·로딩 부담 |
| GLiNER 계열(경량 NER) | 문맥에서 이름 구간 판정 | 50M~340M. 340M 기준 CPU p50 약 170ms(64토큰, 벤더 수치) | 일본어 파인튜닝 존재(품질 미검증) |
| EmbeddingGemma 2 | 매칭 자리 문맥과 용어 '쓰이는 모습' 유사도 비교, 일반어 사전 필터, 별칭 묶기 | 740M(텍스트 270M), 10-06 공개, llama.cpp·Ollama·LM Studio 지원 | 서버 처리량 공개 벤치마크 없음. **직접 측정 필요** |
| 로컬 LLM 예/아니오 | 애매한 자리를 묶어 판정 | 회당 약 5초(E4B 실측) | 작은 모델이라 흔들림 |

**경량 모델 번역 사례(온디바이스)**
- TranslateGemma(4B/12B/27B, 55개 언어): 12B가 Gemma 3 27B보다 WMT24++에서 낫다는 보고. 4B 4비트를 Android에서 돌린 일화에서 짧은 문장은 줄당 1초 미만, 복잡한 문장은 흔들림.
- 0.6B 로컬 모델 실시간 자막 번역: Google 번역 대비 승률 59.2%(GPT-4o mini는 64.6%).
- 일-영 소형 모델(CAT-Translate, 0.8~3.3B), 소량 병렬 데이터 파인튜닝이 품질 향상의 주요인(WMT25).
- 정리: 번역 자체를 더 작은 모델로 옮기면 품질 손해가 크다. 대신 **추출·판정 같은 보조 작업**에 경량 모델을 쓰는 구성이 흔하고 합리적이다.

## 3. 제안 설계(단계별)

### A. 치환을 없애고 '관련 용어 주입 + 사후 보정'으로(주류 방식)
1. 회차·묶음마다 매칭된 용어만 참고 목록으로 넣는다(지금 일반 번역 방식과 같다).
2. 번역 뒤 `missingTerms`처럼 결정적으로 검사해, 원문에 이름이 있는데 번역에 표기가 없거나 다른 표기가 나온 문단만 고른다.
3. 고른 문단만 '이 문단에서 X는 Y로 옮겨 주세요'를 붙여 다시 번역한다(보정 요청 1회, 한 회차에 몇 문단).
- 기대: 단어가 깨질 일이 없다. 보정 요청은 누락 문단에만 나간다.
- 위험: E4B가 목록을 무시하는 비율만큼 보정 요청이 늘어난다. **측정해서 판단한다.**

### B. 매칭 오탐 줄이기(결정적 1차)
- 글자 종류 경계 규칙을 기본으로 둔다. 덩어리 일부에만 걸린 매칭은 '확정 매칭'이 아니라 '후보'로 내리고, 참고 목록에 "이 문단에서 이름으로 쓰였을 때만"이라는 조건을 붙인다(문맥 판단은 모델에 맡김).
- (선택) TinySegmenter로 경계를 한 번 더 확인한다(23KB, 새 의존성은 코드 이식으로 피할 수 있음).

### C. 결정 모델 실험(측정 후 결정)
- EmbeddingGemma 2를 사용자 로컬 서버(`/v1/embeddings`)에 올려 측정한다. 용도는 셋이다.
  1. 애매한 매칭(B의 '후보')이 그 용어를 가리키는지: 매칭 자리 앞뒤 문맥 ↔ 정밀스캔이 모은 그 용어의 등장 문맥 유사도.
  2. 정밀스캔·표기 채우기의 일반어 사전 필터(후보 26개 중 20~22개가 일반 외래어였음).
  3. 별칭 묶기(ルシアナ·ルシアナ様·ルシ).
- 비교 대상: GLiNER 일본어 파인튜닝(이름 구간 판정), 로컬 LLM 일괄 예/아니오.

## 4. 평가 계획

- 데이터: n0421du 1~3화, n2192ms 1~8화(기기 저장본, 원문은 공개 기록에 남기지 않음).
- 비교: 지금(치환) / #235 적용 / A / A+B. C는 측정 스크립트로 따로.
- 지표:
  - 실패 문단 수, 엉뚱한 이름 삽입 수(결정적 검사)
  - 용어 표기 일치율(사람 항목 기준)
  - 회차당 추가 요청 수·시간
  - (C) `/v1/embeddings` 지연: 문맥 10·50·200개 묶음별 p50·p95, 서버 동시 탑재 가능 여부

## 5. 출처
- WMT21 terminology task: https://www.statmt.org/wmt21/terminology-task.html , Lingua Custodia WMT21: https://arxiv.org/pdf/2111.02120 , SYSTRAN WMT21: https://aclanthology.org/2021.wmt-1.69.pdf
- Lingua Custodia WMT19: https://arxiv.org/pdf/1907.04618
- Terminology-Aware Translation with Constrained Decoding and LLM Prompting(WMT23): https://arxiv.org/pdf/2310.05824
- Findings of the WMT25 Terminology Translation Task: https://aclanthology.org/2025.wmt-1.30.pdf
- Coming to Terms with Glossary Enforcement(EAMT 2023): https://aclanthology.org/2023.eamt-1.34.pdf
- MedCT: https://arxiv.org/pdf/2501.06465
- llm-novel-translator: https://github.com/qw02/llm-novel-translator , 책 번역 사례: https://dev.to/jacob_gong/how-we-translate-entire-books-with-llms-without-losing-context-5chm
- EmbeddingGemma 2: https://letsdatascience.com/news/deepmind-releases-embeddinggemma-2-for-edge-search-fbcc7c51
- GLiNER: https://aclanthology.org/2024.naacl-long.300.pdf , GLiNER2.5: https://fastino.ai/models/gliner2-5
- TinySegmenter: https://pypi.org/project/tinysegmenter3/ , Lindera WASM: https://unpkg.com/lindera-wasm-ko-dic@2.1.0/README.md
- llama.cpp 임베딩 서버: https://instagit.com/ggml-org/llama.cpp/how-to-serve-embedding-models-and-use-the-embedding-endpoint
- TranslateGemma: https://wavespeed.ai/blog/posts/what-is-translategemma/ , 온디바이스 자막 번역: https://arxiv.org/pdf/2607.09957 , CAT-Translate: https://arxiv.org/pdf/2606.21413
