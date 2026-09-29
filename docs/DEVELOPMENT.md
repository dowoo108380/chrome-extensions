# 개발 시작하기

이 저장소에는 2.0.0 실행 파일과 TypeScript 원본, 테스트, 빌드 및 패키징 설정이 함께 있습니다.

## 저장소 받기와 개발 도구 준비

Node.js 22 이상과 pnpm 12.6.0이 필요합니다.

```powershell
git clone https://github.com/dowoo108380/chrome-extensions.git
cd chrome-extensions
pnpm install --frozen-lockfile
```

기능 수정은 `src`의 TypeScript 파일에서 진행합니다. `dist`는 빌드 결과이므로 직접 수정하지 않습니다.

## 검사와 배포 파일 생성

```powershell
pnpm test
pnpm run pack
```

`pnpm test`는 타입 검사, 빌드와 Node 단위 검사를 실행합니다. `pnpm run pack`은 `manifest.json`과 `package.json`의 버전에 맞는 설치용 ZIP을 `release`에 생성합니다. Chrome에서 로드할 때는 압축을 풀어 `manifest.json`이 있는 폴더를 선택합니다.

## 브라우저 검사

Python 3.12와 uv로 별도의 검사 환경을 준비할 수 있습니다.

```powershell
uv venv --python 3.12 .venv
uv pip install --python .venv/Scripts/python.exe -r tests/requirements.txt
pnpm test:all
```

Chrome이나 Edge가 설치되어 있으면 검사 도구가 사용할 브라우저를 검색합니다. 자세한 검증 범위와 별도 브라우저 경로 지정 방법은 README의 개발과 검증 절을 참고합니다.

새 버전을 배포할 때는 `manifest.json`, `package.json`과 README의 버전 표기를 함께 갱신하고 검사를 통과한 ZIP을 GitHub Releases에 첨부합니다.

`node_modules`, `.venv`, `analysis`, `.test_*`와 `release`는 로컬에서 생성하는 폴더이며 Git에서 제외합니다. GitHub Actions는 저장소 코드로 검사와 패키징을 실행합니다.
