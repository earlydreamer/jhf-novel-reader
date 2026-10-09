# 제3자 고지

이 앱에 포함된 제3자 구성 요소와 그 라이선스를 적는다. 앱 자체 라이선스는 아직 정하지 않았다.
이 파일은 `node tools/licenses/generate-notices.mjs`로 만든다. 직접 고치지 않는다.

## 직접 가져온 코드와 자산

### LNReader plugins: Syosetu 선택자와 추출 구조

- 출처: https://github.com/LNReader/lnreader-plugins , 고정 커밋 `358388426c0b23674b97760c352ee972b8e4d7b8`, 파일 [`plugins/japanese/Syosetu.ts`](https://github.com/LNReader/lnreader-plugins/blob/358388426c0b23674b97760c352ee972b8e4d7b8/plugins/japanese/Syosetu.ts)
- 라이선스: MIT, Copyright (c) 2021 Rajarshee Chatterjee. 변경 없는 전체 원문은 아래 "라이선스 원문"에 있다.
- 적용 위치: `src/source/parse.ts`(본문·회차 제목 선택자 `BODY`·`TITLE`, 목차 파싱 `parseWork`), `src/source/work.ts`(목차 선택자 사용). 본문 번호 제외 규칙과 페이지별 목차 선택자도 같은 파일에 있다.
- 변경: Cheerio와 플러그인 fetch를 분리된 비활성 브라우저 템플릿과 주입된 SourceTransport로 바꿨다. HTML 대신 구조화된 문단·ruby를 낸다. URL·내비게이션 검증, 결정적 SHA-256 식별자, 접근 페이지 감지, 제한된 파싱, 취소 검사, 이전 선택자를 더했다. 랭킹·검색·필터·표지·user-agent 위장·플러그인 런타임·전체 페이지 수집은 제거했다.
- 주의: 파싱 로직만 재사용한다. 업스트림 소설 픽스처나 본문은 포함하지 않는다. 업스트림 코드 라이선스는 소설 본문에 대한 권리나 자동 접근 허가를 주지 않는다. narou-reader 프로젝트 자체 라이선스는 아직 정하지 않았으며 이 고지는 그것을 정하지 않는다.

### Pretendard Variable

- 출처: https://github.com/orioncactus/pretendard (npm `pretendard@1.3.9`)
- 파일: `src/ui/theme/fonts/PretendardVariable.woff2` (수정 없이 복사)
- 라이선스: SIL Open Font License 1.1. 전체 원문은 아래 "라이선스 원문"에 있다.

### Material Symbols (Outlined, weight 400)

- 출처: https://github.com/google/material-design-icons (npm `@material-symbols/svg-400@0.47.6`)
- 파일: `src/ui/icons/*.svg` (앱이 쓰는 아이콘의 수정 없는 복사본)
- 라이선스: Apache License 2.0. 전체 원문은 아래 "라이선스 원문"에 있다.

### Capacitor Android 기본 구조

- 출처: `@capacitor/cli` 8.5.2가 생성한 `android/` 기본 구조 (https://capacitorjs.com)
- 라이선스: MIT, Copyright (c) 2017-present Drifty Co. 원문은 `android/NOTICE`의 MIT 부분과 같고 아래 "라이선스 원문"에 있다.

## 웹 화면 번들 (npm)

| 패키지 | 버전 | 라이선스 | 출처 |
| --- | --- | --- | --- |
| @aparajita/capacitor-secure-storage | 8.0.1 | MIT | https://github.com/aparajita/capacitor-secure-storage |
| @capacitor/android | 8.5.2 | MIT | https://github.com/ionic-team/capacitor |
| @capacitor/app | 8.1.2 | MIT | https://github.com/ionic-team/capacitor-plugins |
| @capacitor/core | 8.5.2 | MIT | https://github.com/ionic-team/capacitor |
| @capacitor/filesystem | 8.1.4 | MIT | https://github.com/ionic-team/capacitor-filesystem |
| @capacitor/keyboard | 8.0.6 | MIT | https://github.com/ionic-team/capacitor-keyboard |
| @capacitor/preferences | 8.0.1 | MIT | https://github.com/ionic-team/capacitor-plugins |
| @capacitor/synapse | 1.0.4 | MIT | https://www.npmjs.com/package/@capacitor/synapse |
| react | 19.3.0 | MIT | https://github.com/react/react |
| react-dom | 19.3.0 | MIT | https://github.com/react/react |
| scheduler | 0.28.0 | MIT | https://github.com/react/react |
| tslib | 2.8.1 | 0BSD | https://github.com/Microsoft/tslib |

- `@capacitor/synapse` 1.0.4: package.json의 license 필드는 ISC

제외한 패키지:

- `@capacitor/ios`: iOS 전용 네이티브 패키지라 Android APK에 들어가지 않음

## Android 라이브러리 (Maven)

| 아티팩트 | 버전 | 라이선스 |
| --- | --- | --- |
| androidx.activity:activity | 1.11.0 | Apache-2.0 |
| androidx.activity:activity-ktx | 1.11.0 | Apache-2.0 |
| androidx.annotation:annotation | 1.8.1 | Apache-2.0 |
| androidx.annotation:annotation-experimental | 1.4.1 | Apache-2.0 |
| androidx.annotation:annotation-jvm | 1.8.1 | Apache-2.0 |
| androidx.appcompat:appcompat | 1.7.1 | Apache-2.0 |
| androidx.appcompat:appcompat-resources | 1.7.1 | Apache-2.0 |
| androidx.arch.core:core-common | 2.2.0 | Apache-2.0 |
| androidx.arch.core:core-runtime | 2.2.0 | Apache-2.0 |
| androidx.collection:collection | 1.4.2 | Apache-2.0 |
| androidx.collection:collection-jvm | 1.4.2 | Apache-2.0 |
| androidx.concurrent:concurrent-futures | 1.1.0 | Apache-2.0 |
| androidx.coordinatorlayout:coordinatorlayout | 1.3.0 | Apache-2.0 |
| androidx.core:core | 1.17.0 | Apache-2.0 |
| androidx.core:core-ktx | 1.17.0 | Apache-2.0 |
| androidx.core:core-splashscreen | 1.2.0 | Apache-2.0 |
| androidx.core:core-viewtree | 1.0.0 | Apache-2.0 |
| androidx.cursoradapter:cursoradapter | 1.0.0 | Apache-2.0 |
| androidx.customview:customview | 1.0.0 | Apache-2.0 |
| androidx.drawerlayout:drawerlayout | 1.0.0 | Apache-2.0 |
| androidx.emoji2:emoji2 | 1.3.0 | Apache-2.0 |
| androidx.emoji2:emoji2-views-helper | 1.3.0 | Apache-2.0 |
| androidx.fragment:fragment | 1.8.9 | Apache-2.0 |
| androidx.interpolator:interpolator | 1.0.0 | Apache-2.0 |
| androidx.lifecycle:lifecycle-common | 2.6.2 | Apache-2.0 |
| androidx.lifecycle:lifecycle-livedata | 2.6.2 | Apache-2.0 |
| androidx.lifecycle:lifecycle-livedata-core | 2.6.2 | Apache-2.0 |
| androidx.lifecycle:lifecycle-process | 2.6.2 | Apache-2.0 |
| androidx.lifecycle:lifecycle-runtime | 2.6.2 | Apache-2.0 |
| androidx.lifecycle:lifecycle-runtime-ktx | 2.6.2 | Apache-2.0 |
| androidx.lifecycle:lifecycle-viewmodel | 2.6.2 | Apache-2.0 |
| androidx.lifecycle:lifecycle-viewmodel-ktx | 2.6.2 | Apache-2.0 |
| androidx.lifecycle:lifecycle-viewmodel-savedstate | 2.6.2 | Apache-2.0 |
| androidx.loader:loader | 1.0.0 | Apache-2.0 |
| androidx.profileinstaller:profileinstaller | 1.4.0 | Apache-2.0 |
| androidx.resourceinspection:resourceinspection-annotation | 1.0.1 | Apache-2.0 |
| androidx.savedstate:savedstate | 1.2.1 | Apache-2.0 |
| androidx.savedstate:savedstate-ktx | 1.2.1 | Apache-2.0 |
| androidx.startup:startup-runtime | 1.1.1 | Apache-2.0 |
| androidx.tracing:tracing | 1.2.0 | Apache-2.0 |
| androidx.vectordrawable:vectordrawable | 1.1.0 | Apache-2.0 |
| androidx.vectordrawable:vectordrawable-animated | 1.1.0 | Apache-2.0 |
| androidx.versionedparcelable:versionedparcelable | 1.1.1 | Apache-2.0 |
| androidx.viewpager:viewpager | 1.0.0 | Apache-2.0 |
| androidx.webkit:webkit | 1.14.0 | Apache-2.0 |
| com.google.guava:listenablefuture | 1.0 | Apache-2.0 |
| io.ionic.libs:ionfilesystem-android | 1.1.1 | MIT |
| org.apache.cordova:framework | 14.0.1 | Apache-2.0 |
| org.jetbrains.kotlin:kotlin-stdlib | 2.2.20 | Apache-2.0 |
| org.jetbrains.kotlinx:kotlinx-coroutines-android | 1.10.2 | Apache-2.0 |
| org.jetbrains.kotlinx:kotlinx-coroutines-core | 1.10.2 | Apache-2.0 |
| org.jetbrains.kotlinx:kotlinx-coroutines-core-jvm | 1.10.2 | Apache-2.0 |
| org.jetbrains:annotations | 23.0.0 | Apache-2.0 |
| org.jspecify:jspecify | 1.0.0 | Apache-2.0 |

Capacitor·플러그인 Android 모듈은 위 npm 패키지와 같은 라이선스.

- `com.google.guava:listenablefuture`: listenablefuture POM에는 라이선스가 없고 Guava(Apache-2.0)에 속함

## 라이선스 원문

### Apache-2.0

사용 구성 요소: Material Symbols (Outlined, weight 400) 0.47.6, androidx.activity:activity 1.11.0, androidx.activity:activity-ktx 1.11.0, androidx.annotation:annotation 1.8.1, androidx.annotation:annotation-experimental 1.4.1, androidx.annotation:annotation-jvm 1.8.1, androidx.appcompat:appcompat 1.7.1, androidx.appcompat:appcompat-resources 1.7.1, androidx.arch.core:core-common 2.2.0, androidx.arch.core:core-runtime 2.2.0, androidx.collection:collection 1.4.2, androidx.collection:collection-jvm 1.4.2, androidx.concurrent:concurrent-futures 1.1.0, androidx.coordinatorlayout:coordinatorlayout 1.3.0, androidx.core:core 1.17.0, androidx.core:core-ktx 1.17.0, androidx.core:core-splashscreen 1.2.0, androidx.core:core-viewtree 1.0.0, androidx.cursoradapter:cursoradapter 1.0.0, androidx.customview:customview 1.0.0, androidx.drawerlayout:drawerlayout 1.0.0, androidx.emoji2:emoji2 1.3.0, androidx.emoji2:emoji2-views-helper 1.3.0, androidx.fragment:fragment 1.8.9, androidx.interpolator:interpolator 1.0.0, androidx.lifecycle:lifecycle-common 2.6.2, androidx.lifecycle:lifecycle-livedata 2.6.2, androidx.lifecycle:lifecycle-livedata-core 2.6.2, androidx.lifecycle:lifecycle-process 2.6.2, androidx.lifecycle:lifecycle-runtime 2.6.2, androidx.lifecycle:lifecycle-runtime-ktx 2.6.2, androidx.lifecycle:lifecycle-viewmodel 2.6.2, androidx.lifecycle:lifecycle-viewmodel-ktx 2.6.2, androidx.lifecycle:lifecycle-viewmodel-savedstate 2.6.2, androidx.loader:loader 1.0.0, androidx.profileinstaller:profileinstaller 1.4.0, androidx.resourceinspection:resourceinspection-annotation 1.0.1, androidx.savedstate:savedstate 1.2.1, androidx.savedstate:savedstate-ktx 1.2.1, androidx.startup:startup-runtime 1.1.1, androidx.tracing:tracing 1.2.0, androidx.vectordrawable:vectordrawable 1.1.0, androidx.vectordrawable:vectordrawable-animated 1.1.0, androidx.versionedparcelable:versionedparcelable 1.1.1, androidx.viewpager:viewpager 1.0.0, androidx.webkit:webkit 1.14.0, com.google.guava:listenablefuture 1.0, org.apache.cordova:framework 14.0.1, org.jetbrains.kotlin:kotlin-stdlib 2.2.20, org.jetbrains.kotlinx:kotlinx-coroutines-android 1.10.2, org.jetbrains.kotlinx:kotlinx-coroutines-core 1.10.2, org.jetbrains.kotlinx:kotlinx-coroutines-core-jvm 1.10.2, org.jetbrains:annotations 23.0.0, org.jspecify:jspecify 1.0.0

```text

                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

### MIT

사용 구성 요소: LNReader plugins: Syosetu 선택자와 추출 구조 358388426c0b

```text
MIT License

Copyright (c) 2021 Rajarshee Chatterjee

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### OFL-1.1

사용 구성 요소: Pretendard Variable 1.3.9

```text
Copyright (c) 2021, Kil Hyung-jin (https://github.com/orioncactus/pretendard),
with Reserved Font Name Pretendard.

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded, 
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

### MIT

사용 구성 요소: Capacitor Android 기본 구조 8.5.2, @capacitor/android 8.5.2, @capacitor/core 8.5.2

```text
MIT License

Copyright (c) 2017-present Drifty Co.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### MIT

사용 구성 요소: @aparajita/capacitor-secure-storage 8.0.1

```text
Copyright 2020-present Aparajita Fishman

MIT License

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### MIT

사용 구성 요소: @capacitor/app 8.1.2, @capacitor/keyboard 8.0.6, @capacitor/preferences 8.0.1

```text
Copyright 2020-present Ionic
https://ionic.io

MIT License

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### MIT

사용 구성 요소: @capacitor/filesystem 8.1.4, @capacitor/synapse 1.0.4, io.ionic.libs:ionfilesystem-android 1.1.1

```text
MIT License

Copyright (c) 2025 Ionic

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### MIT

사용 구성 요소: react 19.3.0, react-dom 19.3.0, scheduler 0.28.0

```text
MIT License

Copyright (c) Meta Platforms, Inc. and affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 0BSD

사용 구성 요소: tslib 2.8.1

```text
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```
