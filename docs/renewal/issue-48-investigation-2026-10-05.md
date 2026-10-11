# #48 재개 조사 — 전체 입력 전달과 독립 백엔드 비교

2026-10-05 KST. 대상은 [#48](https://github.com/earlydreamer/narou-reader/issues/48)이다. 온디바이스 #49와 T5–T8은 이번 작업에 포함하지 않았다. 소스 기준은 미병합 [PR #47](https://github.com/earlydreamer/narou-reader/pull/47)의 `7074af82743aeedd0165d0f8fcf30b11deb549ad`, tree `cef4d0fb2338f46f4c83d38eaa9064e47b924126`이다. 이 PC에서 새로 clone한 뒤 `codex/48-fidelity-investigation` 브랜치에서 진단 도구·메타데이터·이 기록만 추가했다. 앱의 프롬프트, 제공자, 저장 형식과 설정은 수정하지 않았다.

## 이번에 좁힌 원인 범위

**현재 7B Q4 GGUF와 llama.cpp 계열 실행 경로에서 긴 회차의 생성 충실도가 무너진다. LM Studio만의 HTTP 처리·템플릿·병렬 슬롯을 원인으로 설명하기는 어렵다.**

같은 전체 입력, 공식 user-message 지시, `temperature=0`, `repeat_penalty=1.0`에서 LM Studio와 별도로 실행한 공식 llama.cpp가 **동일한 출력 SHA-256**을 반환했다. 둘 다 4,641자, 4,619 completion tokens, HTTP 200/stop이며 출력 해시는 `b19f7d8be301df9595b7437a983e7734aaf5e3a423607d36c1c34a6e456ee385`다. 단일 슬롯 upstream 실행에서도 같았으므로 LM Studio의 4개 병렬 슬롯이 이 재현의 필수 조건은 아니다.

다만 두 실행은 llama.cpp 계열 구현을 공유한다. **원래 모델의 장문 번역 능력, Q4 양자화 영향, 공통 Hunyuan 구현/커널 문제는 아직 분리하지 않았다.** 현재 결과로 원래 BF16 모델의 결함이나 양자화의 결함을 단정하지 않는다.

## 입력과 모델 파일 확인

- 승인된 `n6517bw` 3화를 앱의 실제 `parseChapter`와 `normalizeChapterInput`으로 준비했다. 187개 문단, 비어 있지 않은 문단 103개, 원문 텍스트 6,792자, 정규 입력 7,258자다.
- 정규 입력 SHA-256은 기존 인계와 동일한 `728939898a852f0c93764a984fe043c5f73ea73010fd4bc5af66a418419d2132`다. 진단 도구는 이 값이 다르면 생성하지 않는다.
- LM Studio의 `lms log stream --json --source model --filter input`을 메모리에서 관찰했다. greedy/recommended/no-repeat/faithful/부분 구간 실행에서 해당 요청의 전체 정규 입력이 포맷된 모델 입력에 그대로 포함됐음을 확인했다. raw 입력·출력은 파일로 저장하지 않았다. 관찰은 서버 전체 이벤트이며 클라이언트의 요청 수와 별도로 기록했다.
- 설치된 Tencent `Hy-MT2-7B-Q4_K_M.gguf`는 4,624,648,896 bytes, SHA-256 `9f96256500f3fc1ab4d64336b58f52a949a95ad7516b0c229476eef782f9f77b`다. 공식 GGUF revision `ab8472660ac61fac25f1af43fac2599d52a8a775`의 배포 해시와 일치한다.
- GGUF의 662자 chat template은 공식 7B revision `9b0eb4e8f001def3e5ff6469a0ac96fdb39ec223`의 `chat_template.jinja`와 일치한다. template SHA-256은 `788ac16c5d7bfefc28655928ad524c8f378a44cb24d24fb125d6a5859b167677`이다.
- 실제 MAINPC 실행 프로세스는 LM Studio runtime `llama.cpp-win-x86_64-nvidia-cuda12-avx2-2.51.0`이었다. catalog ID `narou-hy-mt2-7b`, context 16,384, parallel 4, eval batch 2,048, physical batch 512, flash attention enabled 상태를 확인했다.
- 독립 실행은 공식 llama.cpp `b11415` / commit `8e1642198dcd4e408f8776222d6ae31b74d01187`, CUDA 12.4 Windows x64 portable release다. release의 binary/CUDA archive SHA-256을 확인한 뒤 사용했다. 동일 GGUF를 context 16,384, parallel 1, flash attention on, batch 2,048/512로 열었다. 출력 한도는 `-n -1`이며 새 모델을 다운로드하거나 기존 LM Studio 모델을 unload하지 않았다.

공식 출처: [Tencent 모델 카드](https://huggingface.co/tencent/Hy-MT2-7B), [GGUF 배포](https://huggingface.co/tencent/Hy-MT2-7B-GGUF/tree/ab8472660ac61fac25f1af43fac2599d52a8a775), [chat template](https://huggingface.co/tencent/Hy-MT2-7B/blob/9b0eb4e8f001def3e5ff6469a0ac96fdb39ec223/chat_template.jinja), [LM Studio Chat Completions](https://lmstudio.ai/docs/developer/openai-compat/chat-completions), [독립 엔진 release](https://github.com/ggml-org/llama.cpp/releases/tag/b11415).

## 실제 비교 결과

각 행은 사용자가 승인한 조사를 위한 별개의 명시적 실행이다. 각 실행의 client POST는 1개다. 재시도, 자동 수정 호출, 앱의 청크 번역은 구현하지 않았다. 모든 실행에서 `max_tokens`를 보내지 않았다.

| 실행                  | 변경한 조건                                                        | 입력/출력 tokens | 출력 chars | 모델 시간 | 관찰                                          |
| --------------------- | ------------------------------------------------------------------ | ---------------: | ---------: | --------: | --------------------------------------------- |
| LM Studio official    | 공식 user-message 지시, 서버 기본 샘플링                           |    6,422 / 5,312 |      5,327 |  67,706ms | 독버섯 단서 0                                 |
| LM Studio greedy      | official + temperature 0                                           |    6,422 / 5,546 |      5,598 |  68,588ms | 독버섯 단서 0                                 |
| LM Studio recommended | official + temperature .7, top_p .6, top_k 20, repeat_penalty 1.05 |    6,422 / 5,578 |      5,602 |  67,905ms | 독버섯 단서 0                                 |
| LM Studio faithful    | 빠짐없이 전체 문장을 번역하라는 명시적 지시 + temperature 0        |       6,453 / 28 |         27 |   3,079ms | 원문의 일본어 한 문장을 그대로 반환. 한글 0자 |
| LM Studio no-repeat   | official + temperature 0, repeat_penalty 1.0                       |    6,422 / 4,619 |      4,641 |  54,587ms | 독버섯 단서 0                                 |
| upstream no-repeat    | 같은 GGUF·메시지·샘플링, 별도 엔진/단일 슬롯                       |    6,422 / 4,619 |      4,641 |  53,924ms | 직전 행과 출력 해시까지 동일                  |
| LM Studio middle      | 진단용으로 비어 있지 않은 59–87번 문단만 단독 입력                 |    1,626 / 1,897 |      1,992 |  20,595ms | 약초·독버섯·마력 단서가 반환됨                |

모든 응답은 HTTP 200/stop이었다. 전체 입력의 no-repeat 응답은 input+output 11,041 tokens로 설정된 16,384보다 작다. 이는 단순 출력 cap을 해결책으로 추가할 근거가 아니다.

`middle`은 전체 회차 기준 해시를 확인한 뒤, 진단을 위해 59–87번 비어 있지 않은 문단 사이의 원래 빈 문단을 포함해 추출했다. 입력은 1,819자다. 원문/번역 단서 수는 약초 3/3, 독버섯 2/2, 마력 6/6이며 버섯 전체 단서는 7/8이다. 실제 출력 블록은 29개였다. **문단 수·단어 수로 의미 보존 PASS를 선언하지 않는다.** 이 실험은 해당 구간의 어휘를 생성할 수 있음을 보여 주며 전체 회차 G1을 대체하지 않는다.

새 비교의 전체 의미 대조는 수행하지 않았다. 메타데이터의 `quality`는 `NOT_ASSESSED_LEXICAL_CUES_ONLY`를 유지한다. 기존 인계에서 직접 확인한 29/28문단 누락은 기존 G1 FAIL의 증거이고, 이번 단서 검사는 새 누락 문단 수 판정이 아니다. 초기 `month_duration`/`january` 정규식 단서는 ruby/표현 처리에 적절하지 않아 결론에 사용하지 않았으며 도구의 최신 버전에서는 제외했다.

27자 응답은 임시 메모리 화면의 짧은 번역 문자열만 확인했다. 원문 포함 여부와 한글 0자를 확인해 일본어 복사 응답으로 판정했다. 처음 진행 보고에서 원문에 없는 문장이라고 설명한 것은 포함 여부 확인 전에 내린 부정확한 판단으로, 후속 보고에서 정정했다. 브라우저 플러그인은 구성 파일이 없어 연결에 실패했고 화면을 통한 전체 시각 검토는 하지 않았다.

## 도구와 재현

저장 파일은 이 문서와 [evidence 디렉터리](evidence/issue-48-2026-10-05)에 있는 메타데이터 JSON뿐이다. 소설 본문·raw prompt/response·private endpoint·인증값은 포함하지 않았다. 도구는 모델이 이미 로드됐는지 확인하며 선택 모델을 자동 교체하지 않는다. 저장하는 설정·usage는 허용한 숫자/boolean 필드만 취한다. 입력 해시 불일치 시 POST 0개와 외부 응답 내용이 기록되지 않는 것을 합성 테스트로 확인한다.

프로젝트 루트에서 native Windows Node/npm으로 실행한다. 실제 서버가 있는 PC에서 아래 명령의 모델 ID와 경로를 해당 PC의 준비 상태에 맞춘다. 인증이 필요한 서버의 credential 수집이나 우회는 이 도구의 기능이 아니다.

```powershell
node tools/diagnostics/build-adapter.mjs
node tools/diagnostics/hymt2-fidelity.mjs --mode no-repeat --model narou-hy-mt2-7b --repo . --adapter .superpowers/issue48/adapter.mjs --lms C:/path/to/lmstudio/bin/lms.exe --out .superpowers/issue48/no-repeat-new.json
```

`app`, `official`, `greedy`, `recommended`, `faithful`, `no-repeat`는 별개의 수동 비교 모드다. `--scope diagnostic-middle`은 조사 전용이며 전체 회차 acceptance 실행이 아님을 메타데이터에 표시한다. `--review-port`를 지정한 경우 본문을 localhost 화면의 메모리에만 유지하므로 사용 후 프로세스를 닫아야 한다. 기본 실행은 본문을 출력하거나 저장하지 않고 종료한다.

`run-stock.mjs`는 고정 b11415 실행 파일을 확인한 뒤 localhost 임시 엔진을 띄워 같은 no-repeat 요청을 한 번 보내고, 종료 경로에서 자신이 만든 엔진 프로세스를 정리한다. 공유 LM Studio 설정·모델과 별개다. portable release 및 CUDA archive 해시는 `provenance.json`에 있다.

## 재개 경계와 다음 판별 실험

1. **G1은 계속 FAIL**이다. PR #47은 draft/unmerged이고 #48은 open이며 T5–T8 진행과 병합 조건을 바꾸지 않았다. 이 조사 결과는 원인 범위이며 앱 수정이나 기기 성공 증거가 아니다.
2. 다음으로 같은 7B의 더 높은 정밀도(Q8/BF16)를 같은 전체 입력으로 비교하면 Q4의 영향을 좁힐 수 있다. BF16을 Transformers 등 llama.cpp와 다른 구현에서 실행하는 비교가 공통 Hunyuan 구현과 모델 자체를 분리하는 더 강한 실험이다. 이번에는 추가 모델을 다운로드하지 않았다.
3. 대조군이 전체 의미를 보존하더라도 product acceptance를 자동 변경하지 않는다. 해당 회차를 처음부터 끝까지 대조하고 실제 앱·기기 G1을 다시 확인해야 한다. 짧은 입력 성공을 숨은 청크 번역 도입의 근거로 쓰지 않는다.
4. 원래 MAINPC의 legacy dirty checkout과 PR #47 worktree 파일은 변경하지 않았다. 원격 GitHub 글·이슈·PR·branch도 변경하지 않았다. 이 브랜치의 결과는 현재 PC의 로컬 작업이다.
5. 임시 대조 화면 2개, SSH forward 2개와 독립 stock 엔진을 정리했다. MAINPC에서 진단 port 18748–18750의 남은 listener 0개를 확인했으며 기존 LM Studio 모델은 같은 context/parallel로 idle 상태다. 진단 archive·스크립트·메타데이터는 MAINPC의 별도 작업 디렉터리에 보존했다.

환경 준비 검증: `npm ci`, 기존 웹 607개/41파일, production build 통과. 진단 가드 추가 후 전체 suite는 **609개/42파일 PASS**, typecheck·lint PASS다. Windows checkout의 CRLF 때문에 기본 `format:check`는 실패했으나 `--end-of-line auto`를 추가한 검사는 통과했고 기존 tracked 파일은 변경하지 않았다. 새 진단 가드 2개는 합성 입력/전송으로 통과했다. 진단 스크립트·테스트 자체의 Prettier와 Node syntax 검사도 통과했다. Android 빌드와 휴대폰 G1은 이번에 실행하지 않았다.

