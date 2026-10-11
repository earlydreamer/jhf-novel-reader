# 릴리스 서명과 배포

정식 릴리스 APK는 릴리스 키로 서명한다(#272). 키 파일과 비밀번호는 **저장소·로그·문서·대화 어디에도 남기지 않는다.**

## 1. 키 만들기 (처음 한 번, 키 주인이 직접)

JDK의 `keytool`로 저장소 **밖**에 만든다. 비밀번호는 실행할 때 직접 입력한다. 아래 경로는 예시이며 JDK 설치 위치와 저장소 밖의 키 보관 위치로 직접 바꾼다.

```powershell
& 'C:\path\to\jdk-21\bin\keytool.exe' -genkeypair -v `
  -keystore C:\path\outside-repo\jhf-release.jks -alias jhf-release `
  -keyalg RSA -keysize 4096 -validity 36500
```

- 이름·조직 칸은 비워 두거나 원하는 값을 넣는다. APK 서명 인증서에 그대로 들어간다.
- **키 파일과 비밀번호를 잃으면 같은 앱으로 업데이트를 낼 수 없다.** 키 파일은 다른 저장 장치나 암호화된 백업에 하나 더 둔다.

## 2. 빌드가 키를 찾는 방법

둘 중 하나. 환경 변수가 파일보다 먼저다.

- `android/keystore.properties` (git 제외, 직접 만든다)
  ```properties
  storeFile=C:/path/outside-repo/jhf-release.jks
  storePassword=...
  keyAlias=jhf-release
  keyPassword=...
  ```
- 환경 변수: `JHF_KEYSTORE_FILE`, `JHF_KEYSTORE_PASSWORD`, `JHF_KEY_ALIAS`, `JHF_KEY_PASSWORD`

둘 다 없으면 `assembleRelease`는 서명 없는 APK(`app-release-unsigned.apk`)를 만든다.

## 3. 릴리스 빌드

Node는 `.nvmrc`의 버전(현재 24.21.0)을 사용한다. CI도 같은 파일을 읽는다.
`npm ci`는 Git으로 고정된 Capacitor SystemBars 패치를 적용한다. 이미 적용된
패치는 유지하고, 패키지 버전이나 패치 대상이 다르면 설치를 실패시킨다.
CLI의 `xcode`에 사용하는 `uuid`는 CommonJS 호환 보안 수정 버전 11.1.1로 고정한다.

병합 커밋을 깨끗한 작업 폴더(detached worktree)에 꺼내 빌드한다.

```bash
npm ci && npm run build && npx cap sync android
cd android && ./gradlew --no-daemon :app:assembleRelease
```

확인할 것:
- `apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk` — 릴리스 인증서 SHA-256이 지난 릴리스와 같은지
- `aapt dump badging` — 패키지 이름·버전
- `app/build/generated/sourceProvenance/assets/source-provenance.json` — `dirty: false`, 병합 커밋과 같은지

## 4. 배포

GitHub 릴리스에 APK와 SHA-256을 올린다. 정식 판은 `--prerelease` 없이.

