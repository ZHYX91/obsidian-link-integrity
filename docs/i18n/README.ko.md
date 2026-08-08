# Link Integrity

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Русский](README.ru.md) · [Português (Brasil)](README.pt-BR.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Tiếng Việt](README.vi.md)

Link Integrity는 Broken links와 Isolated files를 찾는 로컬 전용 읽기 전용 Obsidian 진단 플러그인입니다.

## 스크린샷

간결한 사이드바에서 깨진 링크와 고립 파일을 검토합니다.

![Link Integrity 사이드바](../assets/link-integrity-overview-en.png)

Obsidian 설정에서 인덱스, 무시 규칙, 파일 형식과 예상 고립을 구성합니다.

![Link Integrity 설정](../assets/link-integrity-settings-en.png)

## 기능

- Markdown, 임베드, Frontmatter, Canvas와 Bases의 명시적 파일 참조에서 깨진 파일·제목·블록 링크를 보고합니다.
- 다른 기존 Vault 파일과 유효한 들어오는 연결이나 나가는 연결이 없는 파일을 찾습니다. 자기 링크와 외부 URL은 Vault 연결을 만들지 않습니다.
- 깨진 나가는 링크를 포함한 고립 파일은 낮은 신뢰도로 표시합니다.
- 주기 노트, 템플릿, 보관 파일을 가짜 그래프 간선 없이 Expected isolated로 선택 표시합니다.
- Obsidian 파일, 이미지 형식군, 오디오, 비디오, PDF와 설정한 첨부 확장자로 필터링합니다.
- 필요할 때 전체 기준을 만들고 이후에는 증분 업데이트로 결과를 유지합니다.
- 각 진단에서 원본을 열 수 있으며 분석과 인덱싱은 모두 로컬에서 수행됩니다.

Bases 동적 쿼리 결과는 명시적 간선이 아닙니다. 파일은 해결되지만 제목이나 블록이 없으면 파일 수준 연결은 유지되고 하위 경로 진단이 별도로 표시됩니다.

## 요구 사항 및 호환성

- Obsidian 1.12.7 이상.
- 데스크톱과 모바일을 대상으로 하며 실제 호스트와 장치는 각각 별도의 승인 경계입니다.
- 현재 Vault만 진단하고 외부 웹은 확인하지 않습니다.

## 설치

커뮤니티 디렉터리 승인 후 **설정 → 커뮤니티 플러그인 → 탐색**에서 설치할 수 있습니다. [최신 GitHub 릴리스](https://github.com/ZHYX91/obsidian-link-integrity/releases/latest)에서 `link-integrity-<version>.zip`을 다운로드할 수도 있습니다.

수동 설치는 `main.js`, `manifest.json`, `styles.css`를 `Vault/.obsidian/plugins/link-integrity/`에 넣습니다. 업그레이드할 때는 이 세 파일만 교체하고 설정을 초기화하려는 경우가 아니면 `data.json`을 보존하세요.

## 사용법

1. 커뮤니티 플러그인에서 Link Integrity를 활성화합니다.
2. 리본 또는 명령 팔레트에서 사이드바를 열고 **Broken links**와 **Isolated files**를 전환합니다.
3. 진단을 선택해 원본을 엽니다. 필터는 현재 보기만 변경합니다.
4. 시작 스캔이 꺼져 있거나 기준 생성이 실패하면 일반 설정에서 **인덱스 만들기** 또는 **다시 만들기**를 사용합니다. 이후 증분 업데이트가 자동으로 결과를 유지합니다.

## 설정

- **일반**: 언어, 시작 스캔, 그룹화와 인덱스 작업. 기본 언어는 **Obsidian 따르기**입니다.
- **Broken links**: 진단 범주와 미리보기가 있는 이름 지정 무시 규칙.
- **Isolated files**: 기본 파일 형식, 선택적 들어오는 링크 없음 분석, Expected isolated 표시와 규칙.
- 예상 고립 규칙은 형식, 정확하거나 재귀적인 폴더, 날짜 형식, glob과 정규식을 조합합니다. 주기 노트 프리셋은 일·주·월·분기·년을 지원합니다.

설정과 규칙은 `data.json`에 저장되며 파생 링크 그래프는 저장되지 않습니다.

## 제한 사항

- 파일을 삭제하거나 링크를 자동으로 다시 쓰지 않습니다.
- 외부 URL을 네트워크로 검사하지 않습니다.
- Bases 동적 쿼리는 명시적 연결로 계산하지 않습니다.
- Expected isolated 규칙은 후보 보기에만 영향을 주며 깨진 링크를 숨기지 않습니다.
- 자동 테스트는 실제 Obsidian 버전과 장치 승인을 대체하지 않습니다.

## 개인정보 보호 및 보안

모든 처리는 로컬에서 이루어집니다. Link Integrity는 Vault 내용을 업로드하지 않고 계정을 요구하지 않으며 노트를 변경하거나 파생 그래프를 저장하지 않습니다.

## 개발

Node.js 24.18.0과 npm 11.16.0을 사용합니다. `npm ci` 다음 `npm run check`를 실행하세요.

안정 계약: [제품](../product.en.md), [UX](../ux.en.md), [아키텍처](../architecture.en.md), [테스트](../testing-strategy.en.md), [릴리스](../release.en.md). 해당 중국어 원본은 같은 폴더에 있습니다.

## 지원

재현 가능한 오류와 구체적인 제안은 [GitHub Issues](https://github.com/ZHYX91/obsidian-link-integrity/issues)를 사용하세요. 비공개 Vault 경로, 노트 내용 또는 진단 샘플을 게시하지 마세요.

## 라이선스

[MIT](../../LICENSE) © ZhengYX
