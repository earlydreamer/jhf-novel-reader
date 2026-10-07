# Black Shark 2의 온디바이스 Hy-MT2 1.8B 실행 실험

#49의 실행·자원·의미 보존 확인을 위해 모델과 Android CPU 실행 파일을 설치했다. 이 실험은 휴대폰에서 직접 실행한 CLI이며 앱 제공자·설정 화면·JNI 연결을 구현한 결과가 아니다. 기존 앱 minSdk 24와 사용자의 저장본을 유지했다.

## 재현 기준

- 기기: Black Shark 2 SKW-H0, Android 10 / API 29, arm64-v8a, Qualcomm msmnile / Snapdragon 855. 초기 MemTotal 7,700,880KB, MemAvailable 4,103,368KB, `/data` 가용 5,174,760KB.
- 확인한 CPU 기능: NEON, FP16, dot product. GPU·NPU는 사용하지 않았다.
- [공식 모델](https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF): `Hy-MT2-1.8B-Q4_K_M.gguf`, revision `a0c709d9fac510f2c807aa3af52872340dc37a4a`, 1,133,080,448 bytes. 다운로드 파일의 SHA-256 `dc5f44fcf1fa496ee7ad725982c0c8c553a4de00259b53af84c4b89fb0c06699`를 확인했다.
- Engine: llama.cpp build 11146, commit `7fe450e19305b828c199d602c23a8337aaa1f03b`. NDK `27.2.12479018`, Clang 18.0.3, CMake 3.22.1 / Ninja, Release, Android API24, static C++.
- 공통: GPU layers 0, 실행·입력 처리 threads 4, temperature 0, top-p 1, top-k 0, repeat penalty 1. 실제 engine 로그의 sampler와 token 수를 별도로 보존했다.
- 설치한 모델·도구·프롬프트는 작업 소유 임시 경로에만 둔다. 원문·응답·사설 주소·인증값은 공개 저장소에 넣지 않는다. OS 설정·사용자 파일·서버 인증을 변경하지 않았다.

## CPU 빌드의 차이

처음 portable arm64 빌드는 `GGML_NATIVE=OFF`, OpenMP·llamafile·server·OpenSSL off로 실행했다. 짧은 자체 원문은 9,574ms에 정상 종료했으며 sampled RSS는 1,407,900KB였다. 실제 회차의 첫 네 구간은 각각 111,387 / 132,589 / 169,007 / 162,573ms, sampled RSS 최대 1,721,856KB였다.

기기의 dot product 기능을 확인해 가속 빌드를 비교했다. KleidiAI v1.24.0을 활성화한 portable 빌드도 로드·짧은 출력을 완료했지만 해당 engine은 Q4_0/Q8_0용 커널만 제공하고 이 Q4_K_M 모델의 K 양자화 경로는 가속하지 않는다. KleidiAI 활성화 문자열만으로 모델 가속 성공을 주장하지 않는다.

최종 비교에는 `GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16`으로 빌드한 **이 기기 전용 실험 파일**을 사용했다. 실제 로그에서 FP16_VA/DOTPROD가 활성화됐다. 제품에 모든 ARM64 기기의 공통 실행 파일로 넣지 않았으며, 추후 앱 제공자는 feature dispatch나 호환 fallback을 별도로 구현해야 한다.

| 자체 짧은 입력 측정 | Portable | 기기 전용 dot product |
| --- | ---: | ---: |
| 전체 CLI 시간 | 9,574ms | 10,221ms |
| 입력 처리 | 11.74 tokens/s | 36.09 tokens/s |
| 출력 처리 | 6.25 tokens/s | 12.59 tokens/s |
| sampled RSS | 1,407,900KB | 2,301,804KB |

dot product 실행은 가중치 재배치로 로딩 비용·메모리가 늘었다. 짧은 실행에서는 총시간이 줄지 않았다. 이 표는 각 실제 실행의 관측값이며 캐시·발열·백그라운드 상태를 고정한 반복 benchmark가 아니다. `firstStdout`은 텍스트 수신 시점이지 정확한 첫 token latency가 아니다.

기기 전용 `llama-completion` SHA-256은 `9340cf794a4d4beb0812cf37633693977982997cd4d4b57506e6fe087bcfa1a1`, stripped 크기는 7,295,424 bytes다. portable 실행 파일은 `671e1f52ba1d273cea193dcbef0df9f7e5187b31e41b594352e172433d9eefe6`다.

## 실제 중단과 전체 회차

Portable 전체 실험은 네 구간 완료 후 다섯 번째 입력 처리 중 가속 실험으로 교체하기 위해 중단했다. 정확한 작업 소유 경로·PID를 확인하고 SIGTERM을 보냈으며 exit 143, EOS 없음, 부분 결과를 확인했다. 이 결과는 명시적 CLI 중단 증거다. 앱 UI 취소·foreground 이탈·JNI single-flight 검증을 대신하지 않으며 portable 전체 품질 완주 결과로 취급하지 않는다.

기기 전용 빌드의 전체 회차 결과는 아래에 기록한다. 같은 대표 회차의 정규 원문 7,258자를 #74에서 사용하는 순서 그대로 14구간으로 나누어 한 작업에서 순차 실행했다. 각 구간은 context 8,192 / 출력 한도 4,096이며 실제 EOS와 토큰 수를 확인했다. 호출별로 모델을 다시 로드하므로 앱에서 모델을 계속 유지하는 JNI 구현의 성능과 같다고 가정하지 않는다.

| 전체 회차 실행 | 결과와 범위 |
| --- | --- |
| 원문 범위 | PASS: 구간 14개의 입력이 원래 계획과 순서대로 일치하고 전체 7,258자를 포함한다. |
| 실행 완료 | PASS: 14개 모두 exit 0·EOS, 길이 한도 종료나 강제 종료 없음. |
| 처리 시간 | 구간 합계 1,081,058ms, 약 18분 1초. 전체 작업 wall time 1,082,598ms. 구간당 59,281–88,254ms. |
| 실제 token | 구간 입력 최대 502, 출력 최대 482, 합계 최대 984. 각 호출은 context 8,192 안에서 끝났다. |
| 첫 출력 관측 | 구간 firstStdout 19,348–27,514ms. CLI·ADB 수신 시점이며 정확한 첫 token 측정이 아니다. |
| 메모리 | 2초 간격 sampled RSS 최대 2,619,048KB, 약 2.50GiB. 별도 시점 PSS 표본은 2,609,183KB. 정확한 peak PSS는 측정하지 않았다. |
| 온도와 배터리 | USB 충전 중 배터리 온도 시작 36.2°C → 종료 39.0°C, 잔량은 모두 100%. 충전 중 측정이므로 실제 배터리 소모나 SoC 온도 결과가 아니다. |
| 중단·OS 종료 | 이 실행에서 OS 메모리 종료나 45°C 배터리 온도 guard 중단은 관측되지 않았다. 다른 장시간 작업의 안정성을 보장하지 않는다. |

요약은 [원문 없는 실행 메타데이터](evidence/ondevice-hy-mt2-2026-10-07/summary.json)에 기록했다. 원시 source·출력·로그는 작업의 private 증거 경로에만 보존한다.

## 의미 보존과 제품 경계

첫 구간부터 source와 output을 대조했다. 기간을 특정 달로 바꾸는 오류와 약한 체력을 유연성으로 옮기는 오류가 남는다. 단층 건물을 한옥으로 옮기고 상대와의 간격을 없애는 행동을 간격을 만드는 행동으로 바꾸며, 관용구의 뜻 대신 부채처럼 번역하면서 일본어 루비도 남긴다. 더 작은 1.8B 모델의 EOS는 전체 회차 의미 보존 성공을 뜻하지 않는다.

14구간의 처음부터 끝까지 대조 결과 **의미 보존 FAIL**이다. 위 기간·행동·대사 오류 외에 식물·도구·바구니의 의미 변경, 체벌을 하지 않는다는 부정 손실, 수량 누락, 찌는 동작의 변경, 축전기를 저항기로 옮기는 기술 용어 오류, 고유명사 흔들림과 일본어 잔존을 확인했다. 마지막 구간도 신체 위치·관용 표현이 바뀐다. 큰 중간 구간 누락은 발견하지 않았지만 모든 의미가 보존된 결과는 아니다. 문단 수·EOS·정상 exit로 이 대조를 대신하지 않는다.

설치·로딩·실행 가능성은 확인했지만 해당 모델의 품질 실패와 CLI 측정 한계가 있다. #49는 OPEN으로 유지하며 앱 온디바이스 제공자 완료나 기존 G1의 대체로 보고하지 않는다. 현재 제품 검증에는 사용자가 지정한 Linux 모델 서버를 사용한다. 앱 제공자를 구현할 때는 명시적 모델 준비·무결성·용량·라이선스·실제 중단·저장 독립성·네이티브 경계를 포함해야 한다.
