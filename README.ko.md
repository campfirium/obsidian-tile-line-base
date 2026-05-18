<p align="center">
  <a href="README.md"><img alt="English" src="https://img.shields.io/badge/English-59636e?style=flat-square"></a>
  <a href="README.de.md"><img alt="Deutsch" src="https://img.shields.io/badge/Deutsch-59636e?style=flat-square"></a>
  <a href="README.es.md"><img alt="Español" src="https://img.shields.io/badge/Espa%C3%B1ol-59636e?style=flat-square"></a>
  <a href="README.fr.md"><img alt="Français" src="https://img.shields.io/badge/Fran%C3%A7ais-59636e?style=flat-square"></a>
  <a href="README.it.md"><img alt="Italiano" src="https://img.shields.io/badge/Italiano-59636e?style=flat-square"></a>
  <a href="README.ja.md"><img alt="日本語" src="https://img.shields.io/badge/%E6%97%A5%E6%9C%AC%E8%AA%9E-59636e?style=flat-square"></a>
  <a href="README.ko.md"><img alt="한국어" src="https://img.shields.io/badge/%ED%95%9C%EA%B5%AD%EC%96%B4-59636e?style=flat-square"></a>
  <a href="README.nl.md"><img alt="Nederlands" src="https://img.shields.io/badge/Nederlands-59636e?style=flat-square"></a>
  <a href="README.pl.md"><img alt="Polski" src="https://img.shields.io/badge/Polski-59636e?style=flat-square"></a>
  <a href="README.pt.md"><img alt="Português" src="https://img.shields.io/badge/Portugu%C3%AAs-59636e?style=flat-square"></a>
  <a href="README.zh-hans.md"><img alt="简体中文" src="https://img.shields.io/badge/%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-59636e?style=flat-square"></a>
  <a href="README.zh-hant.md"><img alt="繁體中文" src="https://img.shields.io/badge/%E7%B9%81%E9%AB%94%E4%B8%AD%E6%96%87-59636e?style=flat-square"></a>
</p>

# TileLineBase

> **Obsidian을 위한 네이티브 일반 텍스트 데이터베이스**

![TileLineBase hero banner](docs/assets/hero-banner.jpg)

Markdown 노트 안에서 바로 **다차원 테이블**을 만들 수 있습니다. **Frontmatter도, 코드도 필요 없습니다.**

## 빠른 미리 보기

[![TileLineBase product overview](docs/assets/hero-banner.gif)](https://youtu.be/8uoVBkD2--A)

_위 미리 보기를 클릭하면 YouTube에서 더 높은 화질로 볼 수 있습니다._


## 기능

### 강력하고 지능적인 테이블

Markdown 노트 안에서 구조화된 데이터 테이블을 직접 만들고, 다양한 상황에 유연하게 활용할 수 있습니다.

#### 유연한 보기: Table, Kanban, Gallery 및 Slides

하나의 레코드 세트를 네 가지 강력한 방식으로 다룰 수 있습니다.

- **Filtered Table:** **Filter**와 **Sort** 규칙을 자유롭게 조합해 저장된 보기로 사용할 수 있습니다. 프로젝트나 상태별로 데이터를 나누고, 완전한 **여러 줄 텍스트 편집**도 지원합니다.

![TileLineBase table mode view](docs/assets/table-view.jpg)

- **Kanban Board:** Status뿐 아니라 **임의의 Select 또는 List 필드**를 레인으로 매핑할 수 있습니다. Priority, Tags, Author 등으로 손쉽게 다시 그룹화해 노트를 다른 차원에서 살펴볼 수 있습니다.

![TileLineBase kanban mode view](docs/assets/kanban-view.jpg)

- **Gallery View:** 노트를 완전히 사용자 지정 가능한 카드로 시각화합니다. **Template Engine**으로 맞춤 레이아웃을 설계하고, **View Groups**와 **오른쪽 클릭 작업**으로 정리를 더 효율적으로 할 수 있습니다.

![TileLineBase gallery mode view](docs/assets/gallery-view.jpg)

- **Slide View:** 행을 집중하기 좋은 슬라이드로 바꿉니다. 방해 없이 생각을 정리하거나 간단한 프레젠테이션을 만들 때 적합합니다. **레이아웃 사용자 지정**이 쉽고, **인라인 이미지**와 **실시간 미리 보기**도 기본 지원합니다.

![TileLineBase slide mode view](docs/assets/slides-view.jpg)

#### 계층형 행

**Parent-Child Row Mode**를 사용하면 관련 레코드를 두 단계 계층으로 묶어 두면서도, 필터가 적용된 테이블 보기에서 자연스럽게 작업할 수 있습니다.

#### 스마트 필드

기본 **인라인 수식**(간단한 산술), **지능형 날짜/시간 파싱**, 노트와 참조의 **자동 링크**가 매끄럽게 통합되어 있으며 계속 개선되고 있습니다.

#### 내장 GTD 워크플로

**작업 상태 필드**(Todo, In Progress, Done, On Hold, Someday, Canceled)를 내장하고, 해당 필터 보기 그룹과 Kanban 보기를 기본으로 제공합니다. 덕분에 **즉시 쉽고 간편하게 작업 관리**를 시작할 수 있습니다.

### 텍스트에 네이티브한 데이터베이스

완전히 텍스트 기반이며, 복잡한 데이터 형식이나 추가 마크업 없이 구조화된 콘텐츠를 직관적으로 다룰 수 있습니다.

![TileLineBase markdown mode view](docs/assets/markdown-view.jpg)

#### 하나의 노트를 데이터베이스로

관련된 모든 구조화 레코드를 **하나의 `.md` 노트** 안에 긴밀하게 모을 수 있습니다. 이렇게 하면 **맥락상의 연결**을 유지하고, 관리 부담을 줄이며, 전체적인 검토와 사고를 효과적으로 돕습니다.

#### 암묵적 구조화

Frontmatter도 코드 마크업도 필요 없습니다. 데이터 구조는 일반 텍스트 안에 **암묵적으로 포함**되며, **사람과 기계 모두에게 친화적인** 데이터 표현을 제공합니다. 자연스럽게 읽고 쓸 수 있습니다.


### 열린 데이터 상호작용

다양한 내부 및 외부 플랫폼 사이에서 데이터를 편리하게 주고받고 이동할 수 있어, 정보를 더 유연하게 정리하고 활용할 수 있습니다.

#### 텍스트 가져오기 마법사

텍스트 블록을 유효한 TileLineBase 레코드로 빠르게 변환합니다. 간단한 패턴을 정의해 콘텐츠를 필드에 매핑하면, 수동 서식 지정 없이 **필요한 구조를 즉시 생성**할 수 있습니다.

#### Obsidian과의 매끄러운 통합

레코드는 여러 테이블 노트 사이에서 유연하게 이동하거나 **독립적인 Obsidian 노트**로 변환할 수 있습니다. 테이블 노트도 모든 설정을 유지한 채 **Vault 간에 마이그레이션**할 수 있습니다.

#### 쉬운 스프레드시트 동기화

**CSV 가져오기/내보내기**를 지원하고 주요 스프레드시트 소프트웨어와 호환되어, **일괄 편집**과 데이터 정리에 편리합니다.

#### 효율적인 LLM 소통

**명확하고 자기 완결적인 일반 텍스트 형식**을 사용하므로, 추가 처리 없이 **Large Language Models (LLM)** 와 원활하게 상호작용할 수 있습니다.

## 안전 및 아키텍처

*   **Isolation:** 이 플러그인은 TileLineBase 보기로 전환한 특정 파일**만** 처리합니다. 다른 노트를 스캔하지 않습니다.
*   **Decoupling:** 데이터는 `.md` 파일에, 보기 설정은 플러그인에 저장됩니다. 플러그인을 제거해도 노트는 표준 Markdown으로 그대로 남습니다.
*   **Protection:** 내장 자동 백업이 파일 스냅샷 기록을 보관해, 실수로 인한 데이터 손실을 방지합니다.

## 설치

[Obsidian Community Plugins page](https://community.obsidian.md/plugins/tile-line-base)에서 TileLineBase를 설치하거나, Obsidian에서 `obsidian://show-plugin?id=tile-line-base`를 열어 바로 접근할 수 있습니다.

TileLineBase는 데스크톱 전용입니다.

## 개발

로컬 개발에서는 `npm ci`로 의존성을 설치합니다.

`npm install <package>`는 의존성을 의도적으로 추가, 제거 또는 업그레이드하고 `package-lock.json`을 새로 고쳐야 할 때만 사용하세요.

의존성을 변경한 뒤에는 `npm run deps:hardening:check`를 실행하세요.

## 팁과 조정

- [상태 아이콘 및 행 배경 사용자 지정](docs/status-snippet-guide.md)

## 피드백 및 논의

피드백, 제안, 질문, 버그 리포트를 환영합니다. 편한 곳에서 자유롭게 이야기해 주세요.

다음 방법을 사용할 수 있습니다.

* [Obsidian Forum thread](https://forum.obsidian.md/t/tilelinebase-the-native-plain-text-database-for-obsidian/108734)에 참여하거나 새 대화를 시작하세요.
* 더 공식적으로 추적하고 싶은 내용은 [GitHub](https://github.com/campfirium/obsidian-tile-line-base/issues)에 Issue를 열어 주세요.
* 개인 포럼인 [Campfirium](https://forum.campfirium.com/t/tilelinebase-v080-released-the-native-plain-text-database-for-obsidian/753)에 들러도 좋습니다. 더 넓은 아이디어와 곁가지 논의도 환영합니다.

가장 편한 공간을 선택해 주세요.


## 감사의 말

TileLineBase는 훌륭한 오픈 소스 작업 위에 만들어졌습니다.

- [Obsidian](https://obsidian.md/) 및 Obsidian plugin API.
- 핵심 테이블 상호작용 모델을 제공하는 [AG Grid](https://www.ag-grid.com/).
- Obsidian과 TileLineBase 아이콘 워크플로에서 사용하는 아이콘 세트를 제공하는 [Lucide](https://lucide.dev/).
- 드래그 앤 드롭 상호작용을 제공하는 [SortableJS](https://sortablejs.github.io/Sortable/).
- Obsidian 플러그인 생태계에서 런타임 패치 지원을 제공하는 [monkey-around](https://github.com/pjeby/monkey-around).

타사 구성 요소와 라이선스 안내는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 참고하세요.

## 라이선스

TileLineBase는 MIT License로 배포됩니다.
