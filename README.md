# Browser Toolbox 2.0.2

ChatGPT 입력 도구, HTML5 미디어 제어, YouTube 보조 기능, 캡처와 페이지 도구를 제공하는 Chrome Manifest V3 확장 프로그램입니다. Chrome 133 이상을 대상으로 합니다. 실행 시 외부 패키지나 원격 코드를 불러오지 않습니다.

## 설치와 업데이트

1. 배포 ZIP을 풀어 `browser_toolbox_extension` 폴더를 준비합니다.
2. Chrome 주소창에서 `chrome://extensions`를 열고 **개발자 모드 → 압축해제된 확장 프로그램을 로드합니다**로 해당 폴더를 선택합니다.
3. 업데이트는 기존 확장을 삭제하지 않고 같은 설치 경로의 파일을 교체한 뒤 **다시 로드**합니다. 이미 열려 있는 적용 대상 페이지도 새로 고칩니다.

배포 ZIP에는 빌드된 `dist`가 포함되어 있어 개발 도구를 설치할 필요가 없습니다. 

설정은 Chrome의 확장 저장소에 보관됩니다. 

업데이트 전 설정 화면에서 백업할 수 있습니다. 

로컬 영상 파일은 확장 세부정보에서 **파일 URL에 대한 액세스 허용**을 켜야 합니다.

## 기능

| 화면 | 제공 기능 |
|---|---|
| 미디어 | HTML5 영상·오디오 배속 0.07~16배, 탐색 단축키, 드래그 가능한 표시창, 탭·소스별 배속 복원 |
| YouTube | A/B 구간·전체 반복, 선택형 정보·댓글(라이브는 실시간 채팅)·재생목록·추천 탭, 일반 모드 너비 조절, 배속 변경 알림, 진행 막대 장식, 선호 화질 선택 |
| 자막 | 트랙·번역 언어 선택, TXT 저장·복사, 영상 시간에 맞춘 자체 자막 표시 |
| 탭 | URL 복사, 페이지 활성 상태 유지, 선택 사이트의 쿠키·캐시 삭제 |
| 페이지 | 전체·영역 캡처, 요소 숨김과 사이트별 복원, 입력 제한 해제, 파일을 포함한 이미지 생성 |
| ChatGPT | 작성·수정 영역 Ctrl+Enter, 대화 열·작성란 너비 조절 |
| 설정 | ZIP 백업, 가져오기 미리보기와 적용, 진단 복사 |

팝업에서 `Ctrl+K`로 기능을 검색할 수 있습니다. 범주 목록은 방향키·Home·End로 이동합니다. 작은 화면에서는 범주 목록과 본문을 각각 스크롤할 수 있습니다.

### 미디어와 YouTube

기본 미디어 단축키는 `S` 느리게, `D` 빠르게, `R` 원래 배속 전환, `Z` 뒤로, `X` 앞으로, `V` 표시창 전환입니다. A/B 지점 설정은 `A`, `B`입니다. 단축키를 바꾸거나 끌 수 있으며 충돌은 함께 검사합니다. 일반 미디어 기능과 선택형 YouTube 기능은 기본적으로 꺼져 있습니다.

실제 미디어에 적용된 배속과 저장 성공 여부를 구분합니다. A/B 반복은 실제 영상 시각을 사용하며, 숨겨진 탭에서는 URL 확인용 타이머를 멈춥니다. 다시 보일 때 같은 영상이면 지정한 구간을 유지합니다.

확장 재로드로 페이지의 확장 실행 환경이 무효화되면 현재 재생 배속을 유지하고 오래된 미디어 제어·저장 요청을 중단합니다. 이 경우 영상 페이지를 새로 고쳐 연결을 복구합니다. 백그라운드 작업의 정상적인 종료·재시작은 이 상태와 구분하며, 실제 저장 실패나 다른 통신 오류는 원인을 표시합니다.

레이아웃은 원본 DOM을 옮기고 복원합니다. 영상·진행 막대·조작부를 따로 늘리지 않으며 네이티브 플레이어의 크기 갱신을 확인합니다. 일반 모드에서 확인한 너비 정책은 영화관·전체 화면 동안 보관하고, CSS의 모드 조건에 따라 적용합니다. 모드 복귀, 영상 교체, 종료 후의 상태와 실제 측정 결과를 진단에서 구분합니다.

선호 화질 자동 선택은 실제 **설정 → 화질** 메뉴를 이용합니다. 선택 가능한 해상도 중 선호값 이하의 최고값을 고르고, 그 이하가 없으면 최저값을 사용합니다. 한국어·영어 데스크톱 일반 시청 페이지를 대상으로 합니다. 사용자가 해당 영상에서 화질을 직접 선택하면 자동 적용을 중단하며, 다음 영상이나 명시적인 다시 시작 요청에서 재개합니다. Premium 표시만으로 재생 권한이 있다고 판단하지 않습니다. 메뉴의 선택 상태와 실제 디코딩 크기는 별도로 표시합니다.

설정은 확장 아이콘의 **YouTube → 선호 화질 자동 선택**에서 저장합니다. 다른 도구가 YouTube 설정 메뉴에 추가한 `Preferred Quality`·`Preferred Premium` 항목과는 별도의 설정이며, 해당 항목을 조작할 필요가 없습니다. 톱니바퀴 버튼의 설명이 없어도 본 영상 플레이어의 버튼을 찾고, 실제 화질 목록과 선택 표시를 확인한 뒤 결과를 보고합니다.

자막 추출은 실제 플레이어 응답·자막 패널을 사용합니다. 전체 작업은 대기열을 포함해 최대 45초, 개별 네트워크 요청은 최대 12초로 제한합니다. 응답은 최대 8MiB까지 읽으며, 팝업 닫힘·영상 이동·시간 초과 시 작업과 임시 후킹을 정리합니다. 취소된 응답이 나중에 자막을 적용하지 않도록 확인합니다.

배속 동기화 자막은 `TextTrack`·`VTTCue`와 실제 영상 시간축을 사용합니다. 글자 크기, 최대 너비, 줄 수, 위치와 넘침 처리를 조절할 수 있습니다. 원래 CC로 돌아가거나 영상이 교체되면 자체 표시를 정리합니다. 정적 추출로 추적할 수 없는 실시간 방송 자막은 지원하지 않습니다.

### 페이지·파일 도구

우클릭·선택·복사 방해 방지, 클립보드 덧붙이기 방지, 이미지 드래그, 새 탭 링크 동작, 뒤로 가기 방해 대응을 개별적으로 설정합니다. 요소 숨김은 현재 페이지에만 적용하거나 사이트 규칙으로 저장할 수 있습니다.

캡처는 잠시 Chrome 디버거를 연결해 수행하고 성공·실패 후 소유한 연결을 해제합니다. 대기·캡처 중 페이지가 바뀌면 저장을 중단하고 다시 선택하도록 안내합니다. 초대형 캡처는 브라우저에 요청하기 전에 차단합니다. 개발자 도구나 다른 확장이 같은 탭을 디버깅하고 있으면 작업할 수 없는 경우가 있습니다.

파일 포함 이미지는 실제 JPEG·PNG·GIF 표지 뒤에 ZIP32 구조와 원본 파일을 붙입니다. 파일은 압축·암호화하지 않습니다. 이미지로 보거나 복사본의 확장자를 `.zip`으로 바꾸어 파일을 꺼낼 수 있습니다. 이미지 재인코딩·최적화 서비스는 뒤에 붙은 파일을 없앨 수 있습니다. 생성 중 **만들기 취소**를 사용할 수 있습니다. ZIP32 한도와 결과 크기를 미리 검사하며 큰 파일은 일정 크기로 나누어 읽습니다.

## 권한과 데이터

| 권한 | 용도 |
|---|---|
| `storage` | 설정, 요소 숨김 규칙, 탭 세션 상태 |
| `activeTab`, `tabs`, `scripting` | 대상 탭 확인, URL 도구, 페이지 작업 주입 |
| `debugger` | 캡처와 탭 활성 상태 유지 |
| `downloads`, `clipboardWrite` | 이미지·자막·백업 저장, 텍스트 복사 |
| `browsingData` | 사용자가 선택한 사이트의 쿠키·캐시 삭제 |
| HTTP·HTTPS 호스트 접근 | 일반 페이지 도구와 모든 프레임의 미디어 제어 |

사이트 데이터 삭제는 현재 탭의 출처를 다시 확인하고 수행합니다. 쿠키 삭제는 Chrome 동작에 따라 같은 등록 가능 도메인의 다른 하위 도메인 로그인에도 영향을 줄 수 있습니다. 백업에는 선택한 사이트 숨김 규칙이 포함될 수 있으므로 공유 전에 확인하십시오.

파일 결합은 로컬에서 처리합니다. 분석·광고 업로드 기능은 없으며, 자막 기능은 영상 사이트의 자막 요청을 사용합니다. 일반 진단에는 URL·제목·쿠키·토큰·자막 본문·숨김 규칙을 넣지 않습니다. 페이지의 Trusted Types 정책을 비활성화하지 않습니다.

## 개발과 검증

다음 명령은 소스·테스트가 있는 개발 폴더에서 실행합니다. Node 22 이상, pnpm 12.6.0이 필요합니다. TypeScript와 Chrome API 타입은 정확한 버전과 `pnpm-lock.yaml`로 고정합니다.

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
```

전체 실행 소스에 `strict`, `noImplicitAny`, `useUnknownInCatchVariables`를 적용하고 미사용 선언도 검사합니다. 과거 결함을 재현하는 `tests/fixtures/legacy_*`는 당시 컴파일 조건을 별도로 유지합니다.

브라우저 검사는 Python 3.12와 Playwright를 사용합니다. Windows에서 uv로 준비할 수 있습니다.

```powershell
uv venv --python 3.12 .venv
uv pip install --python .venv/Scripts/python.exe -r tests/requirements.txt
pnpm test:all
```

Linux에서는 `.venv/bin/python`으로 설치합니다. Chrome이 없다면 해당 Python으로 `-m playwright install --with-deps chromium`을 실행합니다. 테스트 명령은 브라우저를 자동으로 설치하지 않습니다. `.venv`, `BTX_PYTHON`, 시스템 Python을 검색하고, `BTX_CHROMIUM` 또는 설치된 Chrome·Edge·Playwright Chromium을 사용합니다. 별도 경로도 지정할 수 있습니다.

```powershell
$env:BTX_PYTHON = 'C:\path\to\python.exe'
pnpm test:all --chromium 'C:\path\to\chrome.exe'
pnpm run test:captions
pnpm run test:playlist
pnpm test:integration
pnpm test:accessibility
pnpm test:popup-window
pnpm test:media-runtime
pnpm test:quality
pnpm test:quality-integration
```

`pnpm test`는 Node 검사, `pnpm test:all`은 엄격한 타입 검사·빌드·Node 검사·현재 브라우저 검사 전체를 실행합니다. 결과는 `.test_results`에 기록합니다. 실제 확장 설치 검사는 임시 Chrome 프로필, 임시 다운로드 폴더와 로컬·합성 페이지를 사용합니다. 개인 프로필을 사용하지 않습니다. `test:quality-integration`은 실제 MV3·도구 모음 팝업·저장소·탭 메시지를 사용하고 YouTube 메뉴와 영상만 로컬에서 재현합니다. `test:layout-integration`은 실제 확장과 페이지 사이의 크기 갱신, 진행 막대 탐색, 다음 영상 이동, 기능 해제 시 복원을 검사합니다. `test:full-audit`는 잘못된 설정과 페이지 수명 주기를 포함한 1.77.4 회귀 검사를 실행합니다.

접근성 검사는 키보드, 390px 화면, 확대에 준하는 CSS 뷰포트, 강제 색상 모드를 포함합니다. 실제 스크린 리더, 로그인한 서비스의 모든 UI·광고·실험군, NVIDIA VSR 및 장시간 다중 탭 부하는 별도 확인 대상입니다. 로컬 fixture 검사를 실제 서비스 전체 검증으로 해석하지 않습니다.

## 배포 파일 만들기

```powershell
pnpm test:all
pnpm run pack
```

`pnpm run pack`은 타입 검사와 빌드 후 명시된 실행 파일만 `release/browser-toolbox-2.0.2.zip`에 담습니다. 테스트·로그·분석 자료·소스·의존성은 제외합니다. 버전과 참조 파일을 확인하고 ZIP 및 파일별 SHA-256을 함께 생성합니다. 동일한 소스로 만든 ZIP의 내용과 해시는 재현됩니다.

## 타사 고지

### YouTube Improvements – Layout & Video Enhancer 1.0.2

The progress-decoration stylesheet and its embedded image data in `youtube_progress_theme.css` derive from the userscript supplied by the user.
Userscript metadata credits Feiyt, Thalrien.vx and CY Fung and declares the MIT license.
Original namespace: `feiyt_youtube_improvements`.
Original project identified by the supplied file: https://github.com/Feiyt/youtube-improvements-layout-video-enhancer
The original CSS is scoped under `html[data-btx-youtube-progress]` for reversible, opt-in use.
All image bytes remain embedded locally; no external image requests or remote updater are included.
The new layout and speed UI are separate TypeScript implementations, not a copy of the userscript's private framework patches.
This notice records the license supplied with the userscript and does not assert a separate independent copyright investigation of its embedded artwork.

#### License text included in the supplied source

Copyright (c) 2024 - 2026, Feiyt.
All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
