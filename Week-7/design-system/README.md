# AFM Design System

[shadcn/ui](https://ui.shadcn.com/) 컨벤션을 CDN 단일 파일 환경에 맞춰 옮긴 디자인 시스템. AFM 2기 평일반의 모든 프로젝트가 일관된 톤으로 보이도록 한다.

> **빠른 시작**: 새 프로젝트는 `templates/<팔레트>-starter.html`을 그대로 복사해서 시작.

---

## 핵심 아이디어

- **shadcn 토큰 컨벤션**: 색은 HSL 값을 가진 CSS 변수(`--background`, `--primary`, `--muted`, `--border` …)로만 정의한다.
- **컴포넌트 코드는 한 벌**: Button/Card/Input/Dialog/Badge 등은 토큰만 참조한다 (`bg-primary`, `text-foreground`).
- **팔레트 = 토큰 값 묶음**: `:root`의 변수 값만 바꾸면 동일한 컴포넌트가 다른 톤으로 보인다.
- **빌드 시스템 없음**: React + Tailwind + Babel CDN, 단일 `index.html`.

## 4가지 팔레트

| 팔레트 | 무드 | 추천 용도 |
|---|---|---|
| **shadcn Default** | neutral light, 가장 무난 | 결정 못 했을 때 / 일반 |
| **Editorial Cream** ☀ | 따뜻한 종이 + 테라코타 | 사용자 앱/툴/대시보드/콘텐츠 |
| **Cinematic Dark** 🎬 | 어두운 영화 + 핏빛 | 영상/포스터/티저/콘텐츠 마케팅 |
| **Marian Editorial** 💍 | 풀블리드 사진 + 딥 네이비 | 웨딩/포토 스튜디오/포트폴리오 (marianwedding.co.kr 무드) |
| **Mono Utility** ◻ | 회색 중성 | 결제/관리자/B2B/내부 시스템 |

## 폴더 구조

```
Week-7/design-system/
├── README.md                              ← 지금 이 파일
├── tokens.md                              ← 토큰 정의 + 4팔레트 HSL 값
├── components.md                          ← shadcn-style 컴포넌트 스니펫
├── index.html                             ← 4팔레트 라이브 비교 쇼케이스
└── templates/
    ├── shadcn-base-starter.html           ← Default (light + dark 토글)
    ├── editorial-cream-starter.html       ← Editorial Cream
    ├── cinematic-dark-starter.html        ← Cinematic Dark (grain/scanlines/vignette)
    ├── marian-editorial-starter.html      ← Marian Editorial (풀블리드 히어로 + 네이비)
    └── mono-utility-starter.html          ← Mono Utility
```

## 사용법

### A. 새 프로젝트 시작 (가장 빠름)

```bash
cp Week-7/design-system/templates/editorial-cream-starter.html \
   Week-X/my-new-project/index.html
```

그대로 열어보면 동작한다. `<title>`만 바꾸고 `App` 안의 콘텐츠를 채우면 끝.

### B. 기존 프로젝트에 토큰 시스템 적용

1. `tokens.md`에서 원하는 팔레트의 `:root { --... }` 블록을 복사 → `<style>`에 붙여넣기.
2. `tailwind.config`에 토큰 컬러 매핑 블록 추가 (`tokens.md` § 2 참고).
3. 기존 색 클래스(`bg-gray-900`, `text-white` 등)를 토큰 클래스(`bg-primary`, `text-primary-foreground`)로 교체.
4. 컴포넌트는 `components.md`에서 필요한 만큼 복사.

### C. 컴포넌트 추가가 필요할 때

shadcn 공식 사이트(https://ui.shadcn.com/docs/components)의 컴포넌트 코드를 복사한 뒤:
- `import` 문 제거
- `cva` / `clsx` / `tailwind-merge` → 단순 `cn()` 헬퍼로 대체 (`components.md` 참조)
- `@radix-ui/*` 의존이 있는 경우 자체 구현 또는 단순 버전으로 다운그레이드 (Dialog 예시 있음)

## 의사결정 가이드

> **"이 프로젝트, 어떤 팔레트로?"**

```
사용자가 직접 쓰는 앱/툴/콘텐츠 ─────→ Editorial Cream
영상/포스터/티저/시네마틱 랜딩 ─────→ Cinematic Dark
웨딩/포토 스튜디오/포트폴리오 ─────→ Marian Editorial
결제/관리자/B2B/내부 시스템   ─────→ Mono Utility
못 정함, 그냥 시작하고 싶음   ─────→ shadcn Default
```

## 일관성 규칙 (중요)

새 컴포넌트나 페이지를 만들 때 반드시:

1. **색은 토큰으로만**: `bg-[#ff0000]` 금지. `bg-destructive`, `text-foreground` 같이 쓴다.
2. **variant 이름은 shadcn 표준**: `default | destructive | outline | secondary | ghost | link`
3. **size 이름은 shadcn 표준**: `default | sm | lg | icon`
4. **라운드는 토큰**: `rounded-md`, `rounded-lg` 사용. 직접 `rounded-[12px]` 하지 않기.
5. **dark 모드는 `.dark` 클래스 토글**: 기본은 light, 필요하면 `<html class="dark">`.

## 참고

- shadcn/ui 공식 문서: https://ui.shadcn.com/
- Tailwind CSS: https://tailwindcss.com/
- Pretendard: https://github.com/orioncactus/pretendard
- Radix Colors / HSL 표현: shadcn은 모든 색을 `0 0% 100%` 같은 HSL space-separated 값으로 저장한다.

## 변경 이력

- **v0.1 (2026-04-28)** — 초기 셋업. shadcn 토큰 컨벤션 + 4팔레트 (Default / Editorial Cream / Cinematic Dark / Mono Utility) + 4개 starter 템플릿 + 라이브 쇼케이스.
