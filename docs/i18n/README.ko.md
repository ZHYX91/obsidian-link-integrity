# Link Integrity

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) · [Русский](README.ru.md) · [Tiếng Việt](README.vi.md) · [العربية](README.ar.md)

Link Integrity는 Obsidian 보관함에서 끊어진 링크와 다른 파일에 유효하게 연결되지 않은 노트·첨부 파일을 찾아줍니다. 결과만 보여 주며 링크를 수정하거나 파일을 삭제하지 않습니다.

## 스크린샷

깨진 링크와 고립 파일을 간결한 사이드바에서 확인할 수 있습니다.

![Link Integrity 사이드바](../assets/link-integrity-overview-en.png)

![폴더별로 그룹화된 고립 파일](../assets/link-integrity-isolated-en.png)

Obsidian 설정에서 인덱스, 무시 규칙, 파일 형식, 예상 고립 규칙을 관리할 수 있습니다.

![Link Integrity 설정](../assets/link-integrity-settings-en.png)

## 기능

- 확인된 파일, 제목 및 블록 누락을 경고색 물결 밑줄로 본문에 선택적으로 표시합니다.
- Markdown, 임베드, Frontmatter, Canvas, Bases의 명시적 파일 참조에서 존재하지 않는 파일·제목·블록을 가리키는 내부 링크를 찾습니다.
- 다른 기존 Vault 파일과 유효한 들어오는 링크도 나가는 링크도 없는 파일을 찾습니다. 자기 자신을 가리키는 링크와 외부 URL은 Vault 내부 연결로 계산하지 않습니다.
- 고립 파일에 깨진 나가는 링크가 함께 있으면 별도로 알려, 곧바로 정리해도 되는 파일로 오해하지 않도록 합니다.
- 주기 노트, 템플릿, 보관 파일처럼 의도적으로 독립해 있을 수 있는 파일을 예상된 고립 상태로 표시할 수 있습니다. 결과의 분류만 달라질 뿐 실제 링크 관계는 바뀌지 않습니다.
- Obsidian 파일, 이미지 형식, 오디오, 비디오, PDF, 설정한 첨부 확장자로 고립 파일을 필터링할 수 있습니다.
- 필요할 때 전체 인덱스를 만든 뒤 Vault 변경 사항에 맞춰 자동으로 최신 상태를 유지합니다.
- 정확한 위치를 알 수 있으면 결과에서 해당 위치를 바로 열 수 있습니다. 스캔, 비교, 인덱싱은 모두 로컬에서 수행됩니다.

Bases의 동적 쿼리 결과는 자동으로 링크로 취급하지 않습니다. 대상 파일은 존재하지만 제목이나 블록이 없으면 파일 간 연결은 유지하고, 빠진 제목이나 블록을 별도 문제로 표시합니다.

## 요구 사항 및 호환성

- Obsidian 1.12.7 이상.
- 데스크톱 및 모바일 Obsidian을 지원합니다. 공식 호스트 검증에서는 데스크톱과 Android 에뮬레이터를 별도로 다루며, Android 실기기와 iOS는 해당 검증 범위에 포함되지 않습니다.
- 현재 Vault만 확인합니다. 외부 웹사이트나 원격 리소스는 검사하지 않습니다.

## 설치

**설정 → 커뮤니티 플러그인 → 탐색**을 열고 **Link Integrity**를 검색해 설치하세요. 카탈로그에 아직 표시되지 않으면 [최신 GitHub 릴리스](https://github.com/ZHYX91/obsidian-link-integrity/releases/latest)에서 `link-integrity-<version>.zip`을 다운로드하세요.

수동 설치는 `main.js`, `manifest.json`, `styles.css`를 `Vault/.obsidian/plugins/link-integrity/`에 넣습니다. 업그레이드할 때는 이 세 파일만 교체하고, 설정을 초기화하려는 경우가 아니면 `data.json`을 보존하세요.

## 사용법

1. 커뮤니티 플러그인에서 Link Integrity를 활성화합니다.
2. 리본 또는 명령 팔레트에서 Link Integrity를 엽니다. 사이드바에는 **깨진 링크**와 **고립된 파일**이 있습니다.
3. 결과를 선택하면 원본 파일을 엽니다. 고립 파일 필터는 현재 화면에만 적용되며 저장된 기본 설정을 바꾸지 않습니다.
4. 시작 시 스캔은 기본적으로 꺼져 있습니다. 사이드바를 열면 필요할 때 인덱스를 만들며, 일반 설정의 **인덱스 만들기** 또는 **다시 만들기**를 사용할 수도 있습니다. 첫 인덱스 생성이 성공한 뒤에는 Vault 변경 사항이 결과에 자동 반영됩니다.

노트 본문의 물결 밑줄은 기본적으로 꺼져 있습니다. 편집 또는 읽기 화면에서 켜도 링크를 평소처럼 열 수 있습니다. 링크 위치를 확실히 알 수 없는 경우에는 표시하지 않으므로 사이드바에서 확인하세요.

## 설정

예를 들어 `A.md`에서 존재하는 `[[B]]`로 연결되었다면, `A.md`에 들어오는 링크가 없어도 고립된 파일은 아닙니다. `[[Missing]]`만 있고 다른 유효한 연결이 없다면 고립된 파일이지만, 삭제하기 전에 내용을 확인해야 합니다.

- **일반**: 언어, 시작 시 스캔, 기본 보기, 인덱스 생성/재생성. 기본 언어는 **Obsidian 따르기**입니다.
- **깨진 링크**: 표시할 문제 유형과, 일치 건수를 미리 볼 수 있는 이름 지정 무시 규칙.
- **고립된 파일**: 기본 파일 형식, 선택적 '들어오는 링크 없음' 보기, 예상된 고립, 무시 규칙, 예상 고립 규칙.
- 예상 고립 규칙은 파일 형식, 한 폴더 또는 하위 폴더까지 포함한 범위, 날짜 형식, glob 패턴, 고급 정규식을 조합할 수 있습니다. 주기 노트 프리셋은 일·주·월·분기·년 형식을 지원합니다.

**고급 무시 규칙 주의:** '예상된 고립'과 단순히 결과를 숨기는 규칙은 연결 수를 바꾸지 않습니다. 그러나 연결 분석에서 일치하는 링크를 제외하는 고급 규칙은 그 링크를 연결로 계산하지 않으므로, 실제로 연결된 파일도 고립된 것처럼 표시될 수 있습니다. 적용 전에 일치 항목을 확인하세요.

설정과 사용자 규칙은 `data.json`에 저장됩니다. 계산된 링크 인덱스는 메모리에만 유지되며 다시 시작하면 새로 만듭니다.

## 제한 사항

- Link Integrity는 파일을 삭제하거나 노트 링크를 다시 쓰지 않습니다. 불확실한 본문은 표시하지 않으며 다른 진단은 사이드바에서 확인합니다.
- 외부 URL은 의도적으로 검사 대상에서 제외되며 네트워크로 요청하지 않습니다.
- Bases 동적 쿼리 결과는 직접적인 파일 연결로 계산하지 않습니다. 명시적으로 작성된 파일 참조만 계산합니다.
- 예상 고립 규칙은 이미 고립된 파일의 분류만 바꿉니다. 깨진 링크를 숨기거나 실제 파일 연결을 없애지 않습니다.

## 개인정보 보호 및 보안

색인은 로컬에서 실행됩니다. Vault를 업로드하거나 계정을 요구하거나 본문을 변경하지 않습니다. 파생 색인은 메모리에 유지됩니다.

## 개발

Node.js 24.19.0과 npm 11.17.0을 사용합니다. `npm ci` 다음 `npm run check`를 실행하세요.

개발 문서: [제품](../product-requirements.en.md), [UX](../ux-spec.en.md), [아키텍처](../architecture.en.md), [테스트](../testing-strategy.en.md). 해당 중국어 원문은 같은 폴더에 있습니다.

## 지원

- [Q&A](https://github.com/ZHYX91/obsidian-link-integrity/discussions/categories/q-a): 사용 및 설정 질문.
- [Ideas](https://github.com/ZHYX91/obsidian-link-integrity/discussions/categories/ideas): 검토 중인 기능 및 워크플로 아이디어.
- [Show and tell](https://github.com/ZHYX91/obsidian-link-integrity/discussions/categories/show-and-tell): 사용 팁, 워크플로, 참고 예시.

재현 가능한 오류와 구체적인 제안은 [GitHub Issues](https://github.com/ZHYX91/obsidian-link-integrity/issues/new/choose)를 사용하세요. 비공개 Vault 경로, 노트 내용, 진단 예시 또는 개인 정보를 게시하지 마세요.

## 라이선스

[MIT](../../LICENSE) © ZhengYX
