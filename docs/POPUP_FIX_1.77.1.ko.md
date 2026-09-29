# 1.77.1: 아이콘을 눌렀을 때 팝업이 작게 열리는 오류

1.77.0에 추가한 반응형 CSS가 실제 툴바 팝업을 25×25 CSS 픽셀로 축소하는 회귀를 일으켰습니다. 사용자 이미지와 같은 증상을 임시 Chrome 프로필에서 재현했습니다.

## 원인

`html, body`의 고정 크기에 `max-width: 100vw`, `max-height: 100vh`를 함께 지정했습니다. 툴바 팝업은 처음부터 일반 탭처럼 정해진 뷰포트를 갖는 것이 아니라 콘텐츠를 측정해 크기를 정합니다. 루트 크기를 초기의 작은 뷰포트로 제한해 자동 크기 계산이 작은 값에 머물렀습니다.

Chrome은 action 팝업의 크기를 콘텐츠에 맞춰 자동으로 정하며, 범위는 25×25에서 800×600픽셀입니다. [Chrome action API 공식 문서](https://developer.chrome.com/docs/extensions/reference/api/action#popup)

이전 실제 설치 시험도 `popup.html`을 별도 탭으로 열었습니다. 고정 뷰포트 안의 렌더링·메시지 시험은 통과했지만 툴바 팝업 자체의 자동 크기 계산을 검사하지 못했습니다.

## 수정

- 문서 루트는 780×600의 기본 크기를 제공합니다. 초기 뷰포트를 참조하는 최대 크기 제한을 제거했습니다.
- 안쪽 `.panel`만 실제 가용 뷰포트에 맞춥니다. 작은 창에서도 머리글·본문·하단 상태 영역이 들어갑니다.
- 높이가 작은 넓은 팝업에서도 범주 목록을 스크롤할 수 있도록 했습니다. 이 경로는 125%·200% 배율 검사에서 추가로 확인했습니다.
- 권한·설정 키·기능별 JavaScript 동작은 바꾸지 않았습니다. 배포 버전은 1.77.1입니다.

## 회귀 검증

`tests/run_popup_window_tests.py`는 개인 프로필과 분리된 Chrome에 확장을 설치하고 `chrome.action.openPopup()`으로 실제 action 팝업을 엽니다. 팝업에 Playwright의 탭 뷰포트 재정의를 적용하지 않습니다. Chrome API 모의 구현이나 CSP 비활성화도 사용하지 않습니다.

100%·125%·200% 배율에서 각각 두 번 열어 크기와 본문·하단 영역을 검사합니다. 실제 팝업의 7개 범주를 CDP의 신뢰된 마우스 입력으로 선택하고 내용 전환·넘침·스크롤 위치를 확인합니다. 문서를 단순히 별도 탭으로 여는 것과 구분합니다.

Windows 11 / Chrome 154.0.8037.58의 headless 환경에서 기본 배율 팝업은 795×510 CSS 픽셀이었습니다. 브라우저가 제공하는 공간에 따라 높이가 달라지며, 이 테스트 환경의 125%·200% 배율에서는 각각 약 390·210픽셀이었습니다. 모든 배율에서 메뉴와 하단 영역에 접근했습니다. 실제 운영체제의 모든 배율·모니터 구성을 검증했다는 뜻은 아닙니다.

```powershell
pnpm test
pnpm test:popup-window
pnpm test:popup
pnpm test:accessibility
pnpm run pack
# 전체 브라우저 테스트 환경을 준비한 뒤 배포본도 다시 검사할 수 있습니다.
.venv/Scripts/python.exe scripts/verify_release.py --rebuild --install --chromium 'C:\Program Files\Google\Chrome\Application\chrome.exe'
```

이번 수정의 결과는 `docs/verification/popup-fix-1.77.1/`에 보관합니다. 기존 `docs/verification/verification.json`은 1.77.0 분석·개선 당시 기록입니다. 배포 검증에도 실제 팝업 검사를 추가했습니다.

현재 개발 폴더를 로드한 경우 Chrome의 확장 관리 화면에서 해당 확장의 **다시 로드**를 누르면 반영됩니다. ZIP 설치본을 사용하는 경우 1.77.1을 기존 설치 경로에 교체하고 다시 로드합니다.
