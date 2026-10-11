# 원문 탐색 화면 테마 (#99) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 네이티브 `SourceBrowserActivity`의 툴바·상태 문구·시스템 바·외부 링크 대화상자를 앱 테마 토큰(라이트·다크)에 맞추고, 네이티브 문구를 해요체로 바꾼다.

**Architecture:** 색 결정은 순수 Java 클래스 `SourceBrowserTheme`(토큰 값 + 라이트/다크 판정)에 모아 JVM 단위 테스트로 `tokens.css`와 같은지 검증한다. 테마는 앱이 이미 해석한 값(`MainActivity`가 `ReaderTheme` 플러그인으로 받은 `light`/`dark`)을 플러그인이 Intent extra로 넘기고, 값이 없으면 시스템 야간 모드를 따른다. 액티비티는 AppCompat 로컬 야간 모드를 같은 값으로 맞춰 대화상자도 같은 테마를 쓴다.

**Tech Stack:** Android Java(AppCompat), JUnit 4(JVM 단위), Espresso/UiAutomation 계측 테스트(컴파일만 CI에서 확인).

**Spec:** `docs/superpowers/specs/2026-10-08-ui-design-system-design.md` 4.1절(색 토큰), 6.8절(원문 탐색 테마), 7절(UX 라이팅). 이슈 #99.

## Global Constraints

- 색 값은 `src/ui/theme/tokens.css`의 라이트(`:root`)·다크(`:root[data-theme='dark']`) 값과 같아야 한다. 새 색을 만들지 않는다.
- 터치 대상 최소 48dp, 툴바 높이 64dp(M3 top app bar). 크기는 dp로 변환해 쓴다(현재 `setPadding(16, 8, 16, 8)`은 px라 결함).
- 문구는 해요체. 확인 대화상자 왼쪽(취소) 버튼은 `닫기`.
- 보안 설정(`configureBrowser`의 WebSettings·인터셉트·정책)은 바꾸지 않는다.
- 커밋 형식 `feat: 한국어 설명 (#99)`, 본문 끝 `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`. 경로 명시 stage.

## 판정

- **테마 출처**: 스펙은 "시스템 다크 모드를 따른다"지만, 앱은 사용자 테마 설정(시스템/라이트/다크)을 따른다. 앱을 라이트로 고정한 사용자가 다크 탐색 화면을 보면 어긋나므로 앱이 해석한 테마를 우선하고, 없을 때만 시스템을 따른다. 틀렸을 때 비용: 플러그인 한 줄과 extra 하나.
- **문구**: `뒤로` → `뒤로 가기`(앱 안 접근성 이름과 같게), 안내·오류 문구 해요체, 외부 링크 대화상자 제목 `외부 브라우저에서 열까요?`, 버튼 `닫기`/`열기`. 계측 테스트의 문구 검색을 새 문구로 바꾼다(동작 검증은 그대로).
- **계측 테스트 실행**: CI는 `assembleDebugAndroidTest`로 컴파일만 한다. 실기 실행은 `app.narou.reader` 패키지를 설치·삭제하므로 기기 정책(검증용 `app.narou.reader.devicecheck2`만)과 충돌한다. 이 작업은 컴파일 + JVM 단위 테스트로 검증하고 실기 화면 확인은 별도 단계에서 정한다.

---

### Task 1: 탐색 화면 테마와 문구

**Files:**

- Create: `android/app/src/main/java/app/narou/reader/SourceBrowserTheme.java`
- Create: `android/app/src/test/java/app/narou/reader/SourceBrowserThemeTest.java`
- Modify: `android/app/src/main/java/app/narou/reader/SourceBrowserActivity.java`
- Modify: `android/app/src/main/java/app/narou/reader/SourceBrowserPlugin.java`
- Modify: `android/app/src/main/java/app/narou/reader/MainActivity.java`(해석된 테마 getter)
- Modify: `android/app/src/androidTest/java/app/narou/reader/SourceBrowserInstrumentedTest.java`(문구 검색만)

- [ ] **Step 1: 실패하는 JVM 테스트** — `SourceBrowserThemeTest.java`

```java
package app.narou.reader;

import static org.junit.Assert.*;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.Test;

public class SourceBrowserThemeTest {
    @Test public void appThemeWinsAndSystemIsTheFallback() {
        assertTrue(SourceBrowserTheme.isDark("dark", false));
        assertFalse(SourceBrowserTheme.isDark("light", true));
        assertTrue(SourceBrowserTheme.isDark(null, true));
        assertFalse(SourceBrowserTheme.isDark(null, false));
        assertFalse(SourceBrowserTheme.isDark("sepia", false));
    }

    @Test public void colorsMatchTheWebTokens() throws IOException {
        String css = new String(Files.readAllBytes(tokens()), StandardCharsets.UTF_8);
        String light = block(css, ":root {");
        String dark = block(css, ":root[data-theme='dark'] {");
        assertTokens(light, SourceBrowserTheme.of(false));
        assertTokens(dark, SourceBrowserTheme.of(true));
    }

    private static void assertTokens(String block, SourceBrowserTheme theme) {
        assertEquals(token(block, "surface"), theme.surface);
        assertEquals(token(block, "on-surface"), theme.onSurface);
        assertEquals(token(block, "on-surface-variant"), theme.onSurfaceVariant);
        assertEquals(token(block, "outline-variant"), theme.outlineVariant);
        assertEquals(token(block, "primary"), theme.primary);
        assertEquals(token(block, "primary-fill"), theme.primaryFill);
        assertEquals(token(block, "on-primary"), theme.onPrimary);
    }

    private static Path tokens() {
        // Gradle 단위 테스트의 작업 디렉터리는 android/app이다.
        Path path = Paths.get("..", "..", "src", "ui", "theme", "tokens.css");
        assertTrue("tokens.css를 찾지 못했다: " + path.toAbsolutePath(), Files.exists(path));
        return path;
    }

    private static String block(String css, String opener) {
        int start = css.indexOf(opener);
        assertTrue("블록을 찾지 못했다: " + opener, start >= 0);
        int end = css.indexOf('}', start);
        return css.substring(start, end);
    }

    private static int token(String block, String name) {
        Matcher matcher = Pattern.compile("(?m)^\\s*--" + Pattern.quote(name) + ":\\s*#([0-9a-fA-F]{6});").matcher(block);
        assertTrue("토큰이 없다: --" + name, matcher.find());
        return 0xFF000000 | Integer.parseInt(matcher.group(1), 16);
    }
}
```

- [ ] **Step 2: 실패 확인**

Run(Git Bash): `cd android && JAVA_HOME='/path/to/jdk-21' ANDROID_HOME='/path/to/android-sdk' ./gradlew --no-daemon :app:testDebugUnitTest --tests app.narou.reader.SourceBrowserThemeTest`
Expected: 컴파일 실패(`SourceBrowserTheme` 없음).
(JDK·SDK 경로는 해당 환경의 실제 설치 경로로 바꾼다. 다른 Gradle 데몬·빌드 산출물 정리는 하지 않는다.)

- [ ] **Step 3: `SourceBrowserTheme.java`**

```java
package app.narou.reader;

/** 원문 탐색 화면 색. 값은 src/ui/theme/tokens.css와 같고 SourceBrowserThemeTest가 대조한다. */
final class SourceBrowserTheme {
    static final String EXTRA = "theme";
    final boolean dark;
    final int surface, onSurface, onSurfaceVariant, outlineVariant, primary, primaryFill, onPrimary;

    private SourceBrowserTheme(boolean dark, int surface, int onSurface, int onSurfaceVariant,
                               int outlineVariant, int primary, int primaryFill, int onPrimary) {
        this.dark = dark;
        this.surface = surface;
        this.onSurface = onSurface;
        this.onSurfaceVariant = onSurfaceVariant;
        this.outlineVariant = outlineVariant;
        this.primary = primary;
        this.primaryFill = primaryFill;
        this.onPrimary = onPrimary;
    }

    /** 앱이 해석한 테마를 우선하고, 없거나 알 수 없는 값이면 시스템 야간 모드를 따른다. */
    static boolean isDark(String requested, boolean systemNight) {
        if ("dark".equals(requested)) return true;
        if ("light".equals(requested)) return false;
        return systemNight;
    }

    static SourceBrowserTheme of(boolean dark) {
        return dark
            ? new SourceBrowserTheme(true, 0xFF13131B, 0xFFEEEEF6, 0xFFC9C9DC, 0xFF464659, 0xFFD2D3FF, 0xFFD2D3FF, 0xFF1A1B55)
            : new SourceBrowserTheme(false, 0xFFFAFAFD, 0xFF1A1A28, 0xFF45465C, 0xFFC9C9DA, 0xFF3F4199, 0xFF6667AB, 0xFFFFFFFF);
    }

    /** M3 비활성 색: on-surface의 38%(글자)·12%(채움). */
    static int alpha(int color, float alpha) {
        return (Math.round(alpha * 255) << 24) | (color & 0x00FFFFFF);
    }
}
```

`isDark("sepia", false)`는 `systemNight`(false)를 돌려주므로 테스트와 맞다.

- [ ] **Step 4: 통과 확인** — Step 2 명령 → PASS.

- [ ] **Step 5: `MainActivity` getter와 플러그인 extra**

`MainActivity`에 추가:

```java
    /** 앱이 마지막으로 적용한 테마(light/dark). 아직 없으면 null. */
    String resolvedTheme() {
        return resolvedTheme;
    }
```

`SourceBrowserPlugin.open`의 Intent 생성 뒤:

```java
        if (getActivity() instanceof MainActivity) {
            String theme = ((MainActivity) getActivity()).resolvedTheme();
            if (theme != null) intent.putExtra(SourceBrowserTheme.EXTRA, theme);
        }
```

(Intent를 `Intent intent = new Intent(...).putExtra(START_URL, start);` 그대로 두고 그 다음 줄에 넣는다.)

- [ ] **Step 6: `SourceBrowserActivity` 테마 적용**

1. 필드: `private SourceBrowserTheme theme;`
2. `onCreate` 맨 앞(`super.onCreate` **전**):

```java
        boolean systemNight = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
            == Configuration.UI_MODE_NIGHT_YES;
        theme = SourceBrowserTheme.of(SourceBrowserTheme.isDark(getIntent().getStringExtra(SourceBrowserTheme.EXTRA), systemNight));
        // 대화상자 등 AppCompat 위젯도 같은 테마를 쓰게 한다. super.onCreate 전이라 재생성되지 않는다.
        getDelegate().setLocalNightMode(theme.dark ? AppCompatDelegate.MODE_NIGHT_YES : AppCompatDelegate.MODE_NIGHT_NO);
```

import: `android.content.res.Configuration`, `androidx.appcompat.app.AppCompatDelegate`. 3. 화면·툴바:

```java
        screen.setBackgroundColor(theme.surface);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setMinimumHeight(dp(64));
        toolbar.setPadding(dp(4), 0, dp(4), 0);
        toolbar.setBackgroundColor(theme.surface);
```

`addView(back)`·`addView(close)`는 그대로. `open`은 가운데 가중치 대신 왼쪽 여백을 두고 오른쪽 정렬이 되게 한다:

```java
        toolbar.addView(back);
        View spacer = new View(this);
        toolbar.addView(spacer, new LinearLayout.LayoutParams(0, 1, 1));
        toolbar.addView(open);
        toolbar.addView(close);
```

4. 상태 문구:

```java
        status.setPadding(dp(16), dp(8), dp(16), dp(8));
        status.setTextColor(theme.onSurfaceVariant);
        status.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
```

그 아래 구분선(장식):

```java
        View divider = new View(this);
        divider.setBackgroundColor(theme.outlineVariant);
        screen.addView(divider, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, Math.max(1, dp(1))));
```

(`screen.addView(status)` 다음, `browser` 추가 전.) 5. 시스템 바(`setContentView` 뒤):

```java
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setAppearanceLightStatusBars(!theme.dark);
        getWindow().setStatusBarColor(theme.surface);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            bars.setAppearanceLightNavigationBars(!theme.dark);
            getWindow().setNavigationBarColor(theme.surface);
        }
```

`setStatusBarColor`·`setNavigationBarColor`가 deprecation 경고를 내면 메서드에 `@SuppressWarnings("deprecation")`을 붙인 작은 private 메서드로 옮긴다(Android 15+ edge-to-edge에서는 무시되고, 화면 배경이 막대 뒤를 칠한다). import: `android.os.Build`, `android.util.TypedValue`, `android.view.Gravity`, `androidx.core.view.WindowCompat`, `androidx.core.view.WindowInsetsControllerCompat`. 6. 버튼 생성기 교체:

```java
    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    /** M3 텍스트 버튼: 48dp 터치 영역, primary 글자, 리플 배경. */
    private Button button(String text, int id) {
        Button button = new Button(this);
        button.setId(id);
        button.setText(text);
        button.setContentDescription(text);
        button.setAllCaps(false);
        button.setMinHeight(dp(48));
        button.setMinimumHeight(dp(48));
        button.setMinWidth(dp(48));
        button.setMinimumWidth(dp(48));
        button.setPadding(dp(12), 0, dp(12), 0);
        button.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        button.setTextColor(new ColorStateList(
            new int[][] { new int[] { -android.R.attr.state_enabled }, new int[] {} },
            new int[] { SourceBrowserTheme.alpha(theme.onSurface, 0.38f), theme.primary }));
        TypedValue ripple = new TypedValue();
        if (getTheme().resolveAttribute(android.R.attr.selectableItemBackground, ripple, true))
            button.setBackgroundResource(ripple.resourceId);
        button.setStateListAnimator(null);
        return button;
    }

    /** M3 채움 버튼(주 행동): 40dp 높이 알약 모양, 터치 영역은 48dp를 유지한다. */
    private void fill(Button button) {
        GradientDrawable shape = new GradientDrawable();
        shape.setCornerRadius(dp(20));
        shape.setColor(new ColorStateList(
            new int[][] { new int[] { -android.R.attr.state_enabled }, new int[] {} },
            new int[] { SourceBrowserTheme.alpha(theme.onSurface, 0.12f), theme.primaryFill }));
        button.setBackground(new InsetDrawable(shape, 0, dp(4), 0, dp(4)));
        button.setTextColor(new ColorStateList(
            new int[][] { new int[] { -android.R.attr.state_enabled }, new int[] {} },
            new int[] { SourceBrowserTheme.alpha(theme.onSurface, 0.38f), theme.onPrimary }));
        button.setPadding(dp(16), 0, dp(16), 0);
    }
```

`open = button("이 작품 열기", OPEN_ID); fill(open);`. import: `android.content.res.ColorStateList`, `android.graphics.drawable.GradientDrawable`, `android.graphics.drawable.InsetDrawable`. 7. 외부 링크 대화상자:

```java
        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("외부 브라우저에서 열까요?")
            .setMessage(url)
            .setNegativeButton("닫기", null)
            .setPositiveButton("열기", (d, which) -> { /* 기존 본문 그대로 */ })
            .create();
        dialog.setOnShowListener(shown -> {
            dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setTextColor(theme.primary);
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setTextColor(theme.primary);
        });
        dialog.show();
```

- [ ] **Step 7: 문구 해요체** — `SourceBrowserActivity.java` 안의 사용자 문구를 다음으로 바꾼다:

| 지금                                                                                      | 바꿀 문구                                                                                  |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `뒤로`                                                                                    | `뒤로 가기`                                                                                |
| `작품을 찾은 뒤 ‘이 작품 열기’를 누르세요. 사이트 스크립트와 로그인은 지원하지 않습니다.` | `작품을 찾은 뒤 ‘이 작품 열기’를 눌러 주세요. 사이트 스크립트와 로그인은 지원하지 않아요.` |
| `지원하지 않는 탐색 주소입니다.`                                                          | `지원하지 않는 탐색 주소예요.`                                                             |
| `앱 내 탐색에서는 다운로드를 지원하지 않습니다.`                                          | `앱 안 탐색에서는 다운로드를 지원하지 않아요.`                                             |
| `페이지를 불러오지 못했습니다. 뒤로 가거나 탐색을 다시 열어 주세요.`                      | `페이지를 불러오지 못했어요. 뒤로 가거나 탐색을 다시 열어 주세요.`                         |
| `외부 브라우저를 찾지 못했습니다.`                                                        | `외부 브라우저를 찾지 못했어요.`                                                           |

`grep -n '습니다\|하세요' android/app/src/main/java/app/narou/reader/*.java` 결과가 0줄이 되게 한다(다른 파일에 있으면 보고서에만 적고 고치지 않는다).

- [ ] **Step 8: 계측 테스트 문구** — `SourceBrowserInstrumentedTest.java`의 `"외부 링크"` 검색 3곳을 `"외부 브라우저에서 열까요?"`로, `"취소"` 2곳을 `"닫기"`로 바꾼다. 다른 단언·흐름은 바꾸지 않는다. 메서드 이름·메시지(`cancel button`)는 그대로 둬도 된다. 단, 툴바의 `닫기`(CLOSE_ID) 버튼과 대화상자 `닫기`가 같은 텍스트라 `findAccessibilityNodeInfosByText("닫기")`가 툴바 버튼도 찾는다. 대화상자는 별도 창이라 `getRootInActiveWindow()`는 대화상자 창이지만, 안전하게 루프 조건에 `"외부 브라우저에서 열까요?"` 존재를 이미 요구하므로 그대로 둔다(보고서에 이 점을 적는다).

- [ ] **Step 9: 검증**

```bash
cd android && JAVA_HOME='/path/to/jdk-21' ANDROID_HOME='/path/to/android-sdk' ./gradlew --no-daemon :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug
```

`lintDebug`가 원래부터 실패하면(변경 전 `git stash` 금지 — 대신 실패 항목이 이번 변경 파일과 관련 있는지만 확인) 보고서에 적는다. 웹 쪽은 바뀌지 않으므로 `npx vitest run`은 필요 없다.

- [ ] **Step 10: 커밋** — `feat: 원문 탐색 화면을 앱 테마와 해요체에 맞추기 (#99)`, 6개 경로 명시 stage.

